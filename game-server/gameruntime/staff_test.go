package gameruntime

import (
	"testing"
	"time"

	"coffe-mania/shared/gamewire"
)

// staffRoom is the economy room plus a serving counter holding the dish.
func staffRoom(store *economyStore, roles ...string) (*room, time.Time) {
	r, _ := economyRoom(store)
	r.world.Units = append(r.world.Units, gamewire.Unit{ID: "counter", ItemID: 3080000, Placed: true, X: 6, Y: 3})
	r.grid = newGrid(r.world)
	r.world.Foods[0].CounterID = "counter"
	for i, role := range roles {
		r.world.Staff = append(r.world.Staff, gamewire.StaffMember{ID: string(rune('a' + i)), Name: "Funcionário", Role: role, Appearance: "look"})
	}
	now := time.Now()
	r.syncStaff(now)
	return r, now
}

// run advances the room clock in 100 ms ticks until done reports true.
func run(r *room, from time.Time, limit time.Duration, done func() bool) (time.Time, []string) {
	states := []string{}
	for now := from; now.Before(from.Add(limit)); now = now.Add(100 * time.Millisecond) {
		r.tick(now)
		for _, a := range r.actors {
			if a.Kind == "staff" && (len(states) == 0 || states[len(states)-1] != a.State) {
				states = append(states, a.State)
			}
		}
		if done() {
			return now, states
		}
	}
	return from.Add(limit), states
}

func contains(list []string, value string) bool {
	for _, v := range list {
		if v == value {
			return true
		}
	}
	return false
}

func TestWaiterCarriesTheDishToTheSeatedCustomer(t *testing.T) {
	store := &economyStore{payment: gamewire.Payment{RecipeID: "cake_1", Coins: 4, XP: 1, ServingsLeft: 3, PopularityTenths: 801}}
	r, now := staffRoom(store, "waiter")
	peer := &Peer{ID: "watcher", Out: make(chan []byte, 4096), Kick: func() {}}
	r.peers["watcher"] = peer
	customer := seatedCustomer(r, now)
	customer.Kind = "npc"
	r.tick(now.Add(1100 * time.Millisecond))
	if customer.servedBy != "staff:a" || customer.Patience != nil || r.reserved["dish"] != 1 {
		t.Fatalf("delivery not assigned: servedBy=%q patience=%+v reserved=%v", customer.servedBy, customer.Patience, r.reserved)
	}
	_, states := run(r, now.Add(1200*time.Millisecond), 40*time.Second, func() bool { return customer.State == "eating" })
	if customer.State != "eating" || len(store.consumed) != 1 || !store.waiter[0] {
		t.Fatalf("customer=%s consumed=%v waiter=%v states=%v", customer.State, store.consumed, store.waiter, states)
	}
	// The hand-over pays the tip with the meal, over the customer's head.
	tipped := false
	for _, event := range events(peer) {
		if event.Type == "payment" && event.Payment != nil && event.Payment.Tip == 1 && event.Payment.ActorID == customer.ID {
			tipped = true
		}
	}
	if !tipped {
		t.Fatal("the tip was not broadcast")
	}
	if !contains(states, "picking") || !contains(states, "carrying") {
		t.Fatalf("waiter states = %v", states)
	}
	if len(r.reserved) != 0 || r.dirtOn("table") == nil {
		t.Fatalf("reserved=%v dirt=%+v", r.reserved, r.world.Dirt)
	}
}

func TestCleanerClearsTheDirtyTable(t *testing.T) {
	store := &economyStore{}
	r, now := staffRoom(store, "cleaner")
	r.world.Dirt = []gamewire.Dirt{{TableID: "table", Plates: 2, Since: now.UnixMilli()}}
	_, states := run(r, now.Add(time.Second), 40*time.Second, func() bool { return len(r.world.Dirt) == 0 })
	if len(r.world.Dirt) != 0 || len(store.cleaned) != 1 || store.cleaned[0] != "table" {
		t.Fatalf("dirt=%+v cleaned=%v states=%v", r.world.Dirt, store.cleaned, states)
	}
	if !contains(states, "cleaning") || len(r.claimed) != 0 {
		t.Fatalf("states=%v claimed=%v", states, r.claimed)
	}
}

func TestWaiterClearsPlatesWhenNobodyWaits(t *testing.T) {
	store := &economyStore{}
	r, now := staffRoom(store, "waiter")
	r.world.Dirt = []gamewire.Dirt{{TableID: "table", Plates: 1, Since: now.UnixMilli()}}
	_, states := run(r, now.Add(time.Second), 40*time.Second, func() bool { return len(r.world.Dirt) == 0 })
	if len(store.cleaned) != 1 || !contains(states, "busing") {
		t.Fatalf("cleaned=%v states=%v", store.cleaned, states)
	}
}

func TestDismissedWaiterReturnsTheServing(t *testing.T) {
	r, now := staffRoom(&economyStore{}, "waiter")
	customer := seatedCustomer(r, now)
	customer.Kind = "npc"
	r.tick(now.Add(1100 * time.Millisecond))
	if customer.servedBy == "" {
		t.Fatal("delivery not assigned")
	}
	r.world.Staff = nil
	r.syncStaff(now.Add(2 * time.Second))
	if r.actors["staff:a"] != nil || len(r.reserved) != 0 || customer.servedBy != "" || customer.Patience == nil {
		t.Fatalf("after dismissal: reserved=%v servedBy=%q patience=%+v", r.reserved, customer.servedBy, customer.Patience)
	}
	// With no waiter left the customer helps themself again.
	if r.waitersOnDuty() {
		t.Fatal("waiter still on duty")
	}
}

func TestSleepingRoomDropsStaffJobs(t *testing.T) {
	store := &economyStore{}
	r, now := staffRoom(store, "waiter")
	customer := seatedCustomer(r, now)
	customer.Kind = "npc"
	r.tick(now.Add(1100 * time.Millisecond))
	if err := r.sleep(now.Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if len(r.reserved) != 0 || store.slept == nil || len(store.slept.NPCs) != 1 || store.slept.NPCs[0].PatienceRemaining <= 0 {
		t.Fatalf("reserved=%v saved=%+v", r.reserved, store.slept)
	}
	for _, npc := range store.slept.NPCs {
		if npc.Kind == "staff" {
			t.Fatal("staff saved with the customers")
		}
	}
}

func TestRoleChangeIsBroadcastWithIdentity(t *testing.T) {
	r, now := staffRoom(&economyStore{}, "waiter")
	r.world.Staff[0].Role = "cleaner"
	r.syncStaff(now)
	if a := r.actors["staff:a"]; a == nil || a.Role != "cleaner" || a.job != nil {
		t.Fatalf("role change = %+v", a)
	}
}

func TestIdleStaffLeavesTheDoorway(t *testing.T) {
	r, now := staffRoom(&economyStore{}, "waiter", "cleaner")
	r.world.Foods = nil
	door := Tile{X: 4, Y: 1}
	if a := r.actors["staff:a"]; a.X != door.X || a.Y != door.Y {
		t.Fatalf("staff appear at the door: %d,%d", a.X, a.Y)
	}
	run(r, now.Add(time.Second), 20*time.Second, func() bool { return false })
	for _, id := range []string{"staff:a", "staff:b"} {
		a := r.actors[id]
		if a.Move != nil || abs(a.X-door.X)+abs(a.Y-door.Y) <= 1 {
			t.Fatalf("%s idles in the doorway at %d,%d (move=%v)", id, a.X, a.Y, a.Move)
		}
	}
	// A customer outside the door can come in.
	customer := &entity{Actor: gamewire.Actor{ID: "npc:in", Kind: "npc", X: 4, Y: 0, Outside: true, State: "entering"}}
	r.actors[customer.ID] = customer
	if !r.route(customer, Tile{X: 4, Y: 3}, now.Add(22*time.Second)) {
		t.Fatal("the doorway is still blocked")
	}
}

// place moves an employee to a tile, as if it had walked there.
func place(r *room, id string, x, y int) *entity {
	a := r.actors[id]
	a.X, a.Y, a.Move, a.path = x, y, nil, nil
	r.indexActor(a)
	return a
}

func TestNearestWaiterTakesTheDelivery(t *testing.T) {
	r, now := staffRoom(&economyStore{}, "waiter", "waiter")
	far := place(r, "staff:a", 1, 6)
	near := place(r, "staff:b", 7, 4) // beside the counter at (6,3)
	customer := seatedCustomer(r, now)
	customer.Kind = "npc"
	r.tick(now.Add(1100 * time.Millisecond))
	if near.job == nil || near.job.kind != "deliver" || far.job != nil || customer.servedBy != near.ID {
		t.Fatalf("near job=%+v far job=%+v servedBy=%q", near.job, far.job, customer.servedBy)
	}
}

func TestNearestEmployeeClearsTheDirtyTable(t *testing.T) {
	r, now := staffRoom(&economyStore{}, "cleaner", "cleaner")
	r.world.Foods = nil
	far := place(r, "staff:a", 7, 6)
	near := place(r, "staff:b", 4, 4) // beside the table at (3,3)
	r.world.Dirt = []gamewire.Dirt{{TableID: "table", Plates: 1, Since: now.UnixMilli()}}
	r.tick(now.Add(1100 * time.Millisecond))
	if near.job == nil || near.job.table != "table" || far.job != nil || r.claimed["table"] != near.ID {
		t.Fatalf("near job=%+v far job=%+v claimed=%v", near.job, far.job, r.claimed)
	}
}

func TestStuckEmployeeDoesNotHoldTheDelivery(t *testing.T) {
	r, now := staffRoom(&economyStore{}, "waiter", "waiter")
	far := place(r, "staff:a", 1, 6)
	stuck := place(r, "staff:b", 7, 4) // beside the counter, but waiting on a blocked step
	stuck.path, stuck.waits, stuck.due = []Tile{{X: 7, Y: 5}}, 1, now.Add(time.Hour)
	customer := seatedCustomer(r, now)
	customer.Kind = "npc"
	r.tick(now.Add(1100 * time.Millisecond))
	if far.job == nil || far.job.kind != "deliver" || customer.servedBy != far.ID {
		t.Fatalf("far job=%+v stuck job=%+v servedBy=%q", far.job, stuck.job, customer.servedBy)
	}
}

func TestEmployeeGivesUpAnOccupiedTile(t *testing.T) {
	r, now := staffRoom(&economyStore{}, "waiter")
	a := place(r, "staff:a", 5, 5)
	a.path = []Tile{{X: 5, Y: 6}}
	blocker(r, "npc:x", 5, 6)
	for try := 1; try <= blockedRetries; try++ {
		if r.nextStep(a, now) || len(a.path) == 0 {
			t.Fatalf("try %d: path=%v", try, a.path)
		}
		now = a.due
	}
	if r.nextStep(a, now) || len(a.path) != 0 {
		t.Fatalf("still waiting on the occupied tile: %v", a.path)
	}
}

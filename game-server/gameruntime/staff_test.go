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
	customer := seatedCustomer(r, now)
	customer.Kind = "npc"
	r.tick(now.Add(1100 * time.Millisecond))
	if customer.servedBy != "staff:a" || customer.Patience != nil || r.reserved["dish"] != 1 {
		t.Fatalf("delivery not assigned: servedBy=%q patience=%+v reserved=%v", customer.servedBy, customer.Patience, r.reserved)
	}
	_, states := run(r, now.Add(1200*time.Millisecond), 40*time.Second, func() bool { return customer.State == "eating" })
	if customer.State != "eating" || len(store.consumed) != 1 {
		t.Fatalf("customer=%s consumed=%v states=%v", customer.State, store.consumed, states)
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

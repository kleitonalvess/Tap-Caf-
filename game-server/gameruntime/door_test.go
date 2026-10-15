package gameruntime

import (
	"fmt"
	"math/rand"
	"testing"
	"time"

	"coffe-mania/shared/gamewire"
)

// starterLayout is the furniture of a new café (database/room.go), where the
// door, the stove and the owner cooking beside it leave little room to pass.
func starterLayout() []gamewire.Unit {
	return []gamewire.Unit{
		{ID: "door", ItemID: 3010000, Placed: true, X: 4, Y: 1, Rotation: 1},
		{ID: "stove", ItemID: 3070000, Placed: true, X: 6, Y: 2, Rotation: 3},
		{ID: "counter", ItemID: 3080000, Placed: true, X: 7, Y: 3},
		{ID: "c1", ItemID: 3040001, Placed: true, X: 2, Y: 3}, {ID: "c2", ItemID: 3040001, Placed: true, X: 2, Y: 5}, {ID: "c3", ItemID: 3040001, Placed: true, X: 5, Y: 5},
		{ID: "t1", ItemID: 3030010, Placed: true, X: 3, Y: 3}, {ID: "t2", ItemID: 3030010, Placed: true, X: 3, Y: 5}, {ID: "t3", ItemID: 3030010, Placed: true, X: 6, Y: 5},
		{ID: "b1", ItemID: 3020003, Placed: true, X: 1, Y: 1}, {ID: "b2", ItemID: 3020003, Placed: true, X: 7, Y: 1}, {ID: "b3", ItemID: 3020003, Placed: true, X: 7, Y: 7},
		{ID: "lb", ItemID: 3300000, Placed: true, X: 1, Y: 7},
	}
}

func starterRoom(now time.Time) *room {
	r, _ := economyRoom(&economyStore{})
	r.world.Units = starterLayout()
	r.world.Foods = nil
	r.grid = newGrid(r.world)
	r.spawnAt = now
	return r
}

func standing(r *room, a *entity) {
	r.actors[a.ID] = a
	r.indexActor(a)
}

// A waiter hired while customers eat (their plates are already dirty) clears
// every table, whatever the timing and with the owner cooking by the stove.
func TestWaiterHiredMidMealClearsTheTables(t *testing.T) {
	seats := []struct {
		chair, table string
		x, y         int
	}{{"c1", "t1", 2, 3}, {"c2", "t2", 2, 5}, {"c3", "t3", 5, 5}}
	for seed := int64(0); seed < 300; seed++ {
		rng := rand.New(rand.NewSource(seed))
		now := time.Now()
		r := starterRoom(now.Add(time.Duration(rng.Intn(3000)) * time.Millisecond))
		standing(r, &entity{Actor: gamewire.Actor{ID: "human:owner", Kind: "human", X: 5, Y: 2, State: "idle"}})
		for i, st := range seats {
			a := &entity{Actor: gamewire.Actor{ID: fmt.Sprintf("npc:%d", i), Kind: "npc", X: st.x, Y: st.y, State: "eating", ChairID: st.chair, TableID: st.table, EmotionShown: true,
				Food: &gamewire.Food{ID: "f", Recipe: "pao_de_queijo"}, Action: &gamewire.ActorAction{Kind: "eating", StartedAt: now.UnixMilli(), Duration: 5000}}}
			a.due = now.Add(time.Duration(1000+rng.Intn(8000)) * time.Millisecond)
			r.seats[st.chair] = a.ID
			standing(r, a)
			r.world.Dirt = append(r.world.Dirt, gamewire.Dirt{TableID: st.table, Plates: 1, Since: now.UnixMilli()})
		}
		hireAt, hired := now.Add(time.Duration(rng.Intn(10000))*time.Millisecond), false
		for end := now.Add(2 * time.Minute); now.Before(end) && len(r.world.Dirt) > 0; now = now.Add(100 * time.Millisecond) {
			if !hired && !now.Before(hireAt) {
				r.world.Staff = []gamewire.StaffMember{{ID: "w", Name: "W", Role: "waiter", Appearance: "look"}}
				r.syncStaff(now)
				hired = true
			}
			r.tick(now)
		}
		if len(r.world.Dirt) > 0 {
			w := r.actors["staff:w"]
			t.Fatalf("seed %d: %d tables still dirty after 2 min; waiter at (%d,%d) path=%v", seed, len(r.world.Dirt), w.X, w.Y, w.path)
		}
	}
}

// The state once seen frozen live: the waiter on the door tile, customers
// leaving in front of it and one waiting outside. Wherever the owner stands,
// the waiter moves on and every table gets cleared.
func TestWaiterOnTheDoorLetsCustomersOut(t *testing.T) {
	for oy := 1; oy < 8; oy++ {
		for ox := 1; ox < 8; ox++ {
			now := time.Now()
			r := starterRoom(now.Add(time.Hour))
			r.world.Dirt = []gamewire.Dirt{{TableID: "t1", Plates: 1}, {TableID: "t2", Plates: 1}, {TableID: "t3", Plates: 1}}
			for i, p := range []Tile{{X: 4, Y: 2}, {X: 3, Y: 2}, {X: 2, Y: 2}} {
				standing(r, &entity{Actor: gamewire.Actor{ID: fmt.Sprintf("npc:%d", i), Kind: "npc", X: p.X, Y: p.Y, State: "leaving", EmotionShown: true}})
			}
			standing(r, &entity{Actor: gamewire.Actor{ID: "npc:in", Kind: "npc", X: 4, Y: 0, Outside: true, State: "entering"}})
			standing(r, &entity{Actor: gamewire.Actor{ID: "staff:w", Kind: "staff", Role: "waiter", X: 4, Y: 1, State: "idle"}})
			r.world.Staff = []gamewire.StaffMember{{ID: "w", Name: "W", Role: "waiter", Appearance: "look"}}
			if owner := (Tile{X: ox, Y: oy}); !r.grid.walkable(owner) || r.occupied(owner, "") {
				continue
			}
			standing(r, &entity{Actor: gamewire.Actor{ID: "human:owner", Kind: "human", X: ox, Y: oy, State: "idle"}})
			for end := now.Add(90 * time.Second); now.Before(end); now = now.Add(100 * time.Millisecond) {
				r.tick(now)
			}
			if len(r.world.Dirt) > 0 || r.actors["npc:0"] != nil {
				w := r.actors["staff:w"]
				t.Fatalf("owner at (%d,%d): %d dirty tables, waiter at (%d,%d) path=%v", ox, oy, len(r.world.Dirt), w.X, w.Y, w.path)
			}
		}
	}
}

// boxedDoorway puts a waiter on the door tile with every tile around it taken.
func boxedDoorway(now time.Time) (*room, *entity) {
	r := starterRoom(now.Add(time.Hour))
	for i, t := range []Tile{{X: 3, Y: 1}, {X: 5, Y: 1}, {X: 3, Y: 2}, {X: 4, Y: 2}, {X: 5, Y: 2}} {
		standing(r, &entity{Actor: gamewire.Actor{ID: fmt.Sprintf("human:%d", i), Kind: "human", X: t.X, Y: t.Y, State: "idle"}})
	}
	w := &entity{Actor: gamewire.Actor{ID: "staff:w", Kind: "staff", Role: "waiter", X: 4, Y: 1, State: "idle"}}
	standing(r, w)
	r.world.Staff = []gamewire.StaffMember{{ID: "w", Name: "W", Role: "waiter", Appearance: "look"}}
	return r, w
}

func TestEmployeeNeverHoldsTheDoorway(t *testing.T) {
	now := time.Now()
	r, w := boxedDoorway(now)
	r.tick(now)
	for end := now.Add(doorwayGrace - 200*time.Millisecond); now.Before(end); now = now.Add(100 * time.Millisecond) {
		r.tick(now)
	}
	if w.X != 4 || w.Y != 1 {
		t.Fatalf("moved before the grace: (%d,%d)", w.X, w.Y)
	}
	for end := now.Add(time.Second); now.Before(end); now = now.Add(100 * time.Millisecond) {
		r.tick(now)
	}
	here := Tile{X: w.X, Y: w.Y}
	if r.doorway(here) || r.occupied(here, w.ID) || !r.grid.walkable(here) {
		t.Fatalf("waiter still blocks the way at %+v", here)
	}
}

func TestWorkingEmployeeStaysInTheDoorway(t *testing.T) {
	now := time.Now()
	r, w := boxedDoorway(now)
	w.State = "busing"
	w.Action = &gamewire.ActorAction{Kind: "busing", StartedAt: now.UnixMilli(), Duration: 10000}
	w.due = now.Add(10 * time.Second)
	for end := now.Add(3 * time.Second); now.Before(end); now = now.Add(100 * time.Millisecond) {
		r.tick(now)
	}
	if w.X != 4 || w.Y != 1 {
		t.Fatalf("a working employee was moved: (%d,%d)", w.X, w.Y)
	}
}

package gameruntime

import (
	"testing"
	"time"

	"coffe-mania/shared/gamewire"
)

// blocker stands an idle actor on a tile.
func blocker(r *room, id string, x, y int) {
	a := &entity{Actor: gamewire.Actor{ID: id, Kind: "npc", X: x, Y: y, State: "idle"}}
	r.actors[id] = a
	r.indexActor(a)
}

// walker is a player at (5,4) whose planned path starts with the diagonal (6,5).
func walker(r *room) *entity {
	a := &entity{Actor: gamewire.Actor{ID: "human:p", Kind: "human", X: 5, Y: 4, State: "idle"}}
	a.path = []Tile{{X: 6, Y: 5}, {X: 7, Y: 6}}
	r.actors[a.ID] = a
	r.indexActor(a)
	return a
}

func TestBlockedCornerIsWalkedAround(t *testing.T) {
	r, _ := economyRoom(&economyStore{})
	a := walker(r)
	// Both sides of the diagonal got occupied after the path was planned.
	blocker(r, "npc:x", 6, 4)
	blocker(r, "npc:y", 5, 5)
	if !r.nextStep(a, time.Now()) || a.Move == nil {
		t.Fatalf("the walker stopped: path=%v waits=%d", a.path, a.waits)
	}
	to := a.Move.To
	if to == (Tile{X: 6, Y: 5}) || to == (Tile{X: 6, Y: 4}) || to == (Tile{X: 5, Y: 5}) {
		t.Fatalf("stepped through the blocked corner to %+v", to)
	}
	if last := a.path[len(a.path)-1]; last != (Tile{X: 7, Y: 6}) {
		t.Fatalf("lost the destination: %v", a.path)
	}
}

func TestBlockedCornerWaitsBeforeGivingUp(t *testing.T) {
	r, _ := economyRoom(&economyStore{})
	a := walker(r)
	// Every other way out of (5,4) is taken: only the cut corner remains.
	for i, t := range []Tile{{X: 4, Y: 3}, {X: 5, Y: 3}, {X: 6, Y: 3}, {X: 4, Y: 4}, {X: 6, Y: 4}, {X: 4, Y: 5}, {X: 5, Y: 5}} {
		blocker(r, "npc:"+string(rune('a'+i)), t.X, t.Y)
	}
	now := time.Now()
	for try := 1; try <= blockedRetries; try++ {
		if r.nextStep(a, now) || len(a.path) == 0 || a.waits != try || !a.due.After(now) {
			t.Fatalf("try %d: moved=%v path=%v waits=%d", try, a.Move != nil, a.path, a.waits)
		}
		now = a.due
	}
	if r.nextStep(a, now) || len(a.path) != 0 {
		t.Fatalf("still waiting after %d tries: %v", blockedRetries, a.path)
	}
	// Once the corner clears, a new walk goes through.
	r.unindexActor("npc:e")
	delete(r.actors, "npc:e")
	if !r.route(a, Tile{X: 7, Y: 6}, now) || a.Move == nil {
		t.Fatal("no walk after the corner cleared")
	}
}

func TestPlayerKeepsThePathWhileBlocked(t *testing.T) {
	r, _ := economyRoom(&economyStore{})
	a := walker(r)
	for i, t := range []Tile{{X: 4, Y: 3}, {X: 5, Y: 3}, {X: 6, Y: 3}, {X: 4, Y: 4}, {X: 6, Y: 4}, {X: 4, Y: 5}, {X: 5, Y: 5}} {
		blocker(r, "npc:"+string(rune('a'+i)), t.X, t.Y)
	}
	now := time.Now()
	r.tick(now)
	if len(a.path) == 0 {
		t.Fatal("the player gave up on the first blocked step")
	}
	r.unindexActor("npc:d")
	delete(r.actors, "npc:d")
	r.tick(a.due)
	if a.Move == nil {
		t.Fatalf("the player did not resume once a way opened: path=%v", a.path)
	}
}

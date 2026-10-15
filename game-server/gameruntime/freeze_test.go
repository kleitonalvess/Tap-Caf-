package gameruntime

import (
	"testing"
	"time"

	"coffe-mania/shared/gamewire"
)

func TestFrozenForIgnoresBusyTicks(t *testing.T) {
	tick := time.Second / 3
	t0 := time.Now()
	for _, c := range []struct {
		gap  time.Duration
		want time.Duration
	}{{tick, 0}, {3 * time.Second, 0}, {freezeGap + tick, 0}, {time.Minute, time.Minute - tick}} {
		if got := frozenFor(t0, t0.Add(c.gap), tick); got != c.want {
			t.Errorf("gap %v: frozen %v, want %v", c.gap, got, c.want)
		}
	}
	if frozenFor(time.Time{}, t0, tick) != 0 {
		t.Error("the first tick counted as a freeze")
	}
}

// A process frozen mid-meal resumes with the customer's wait, meal and the
// next arrival where they were, instead of all expiring at once.
func TestShiftClocksMovesEveryTimer(t *testing.T) {
	now := time.Now()
	r := starterRoom(now)
	a := &entity{Actor: gamewire.Actor{ID: "npc:1", Kind: "npc", X: 2, Y: 3, State: "seated",
		Action: &gamewire.ActorAction{Kind: "eating", StartedAt: now.UnixMilli(), Duration: 5000},
		Move:   &gamewire.Movement{From: Tile{X: 2, Y: 3}, To: Tile{X: 2, Y: 4}, StartedAt: now.UnixMilli(), Duration: 667}}}
	a.due = now.Add(5 * time.Second)
	a.restorePatience(now.Add(40 * time.Second))
	a.fetchAt = now.Add(3 * time.Second)
	standing(r, a)
	pause := 6 * time.Hour
	r.shiftClocks(pause)
	if !a.due.Equal(now.Add(5*time.Second+pause)) || !a.patienceUntil.Equal(now.Add(40*time.Second+pause)) || !a.fetchAt.Equal(now.Add(3*time.Second+pause)) {
		t.Fatalf("timers: due %v patience %v fetch %v", a.due.Sub(now), a.patienceUntil.Sub(now), a.fetchAt.Sub(now))
	}
	if a.Action.StartedAt != now.Add(pause).UnixMilli() || a.Move.StartedAt != now.Add(pause).UnixMilli() {
		t.Fatalf("action %d move %d", a.Action.StartedAt-now.UnixMilli(), a.Move.StartedAt-now.UnixMilli())
	}
	if a.Patience == nil || a.Patience.StartedAt+a.Patience.Duration != now.Add(40*time.Second+pause).UnixMilli() {
		t.Fatalf("broadcast patience %+v", a.Patience)
	}
	if !r.spawnAt.Equal(now.Add(pause)) {
		t.Fatalf("spawn %v", r.spawnAt.Sub(now))
	}
	r.shiftClocks(0)
	if !r.spawnAt.Equal(now.Add(pause)) {
		t.Fatal("a zero pause moved the clocks")
	}
}

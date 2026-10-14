package main

import (
	"testing"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/roomcatalog"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// sleptAgo marks the room as asleep since the given time before now.
func sleptAgo(t *testing.T, app core.App, owner string, ago time.Duration) time.Time {
	t.Helper()
	now := time.Now()
	room := roomRecord(t, app, owner)
	room.Set("slept_at", types.NowDateTime().Add(-ago))
	if err := app.Save(room); err != nil {
		t.Fatal(err)
	}
	return now
}

func placedUnits(t *testing.T, app core.App, owner string) []*core.Record {
	t.Helper()
	units, err := app.FindRecordsByFilter("player_inventory", "user={:user} && placed=true", "id", 0, 0, dbx.Params{"user": owner})
	if err != nil {
		t.Fatal(err)
	}
	return units
}

func TestDiningSeatsFollowTheChairsFacingTables(t *testing.T) {
	app, owner, _ := newKitchen(t)
	seats := diningSeats(placedUnits(t, app, owner))
	tables := map[string]bool{}
	for _, seat := range seats {
		tables[seat.table] = true
	}
	// The starter café: three chairs, each facing its own table.
	if len(seats) != 3 || len(tables) != 3 {
		t.Fatalf("seats = %+v", seats)
	}
}

func TestShortAbsenceJustResumes(t *testing.T) {
	app, owner, _ := newKitchen(t)
	addFood(t, app, owner, 4)
	now := sleptAgo(t, app, owner, time.Minute)
	summary, err := wakeRoom(app, owner, now)
	if err != nil || summary != nil || !roomRecord(t, app, owner).GetDateTime("slept_at").IsZero() {
		t.Fatalf("short absence: %+v (%v)", summary, err)
	}
	if dirt := plates(t, app, owner); len(dirt) != 0 {
		t.Fatalf("a short absence served customers: %+v", dirt)
	}
}

func TestAbsenceWithoutStaffFillsEachCleanSeatOnce(t *testing.T) {
	app, owner, _ := newKitchen(t)
	addFood(t, app, owner, 10)
	cake := recipe(t, "cake_1")
	before := playerState(t, app, owner)
	gold, popularity := before.GetInt64("gold"), before.GetInt("satisfaction_current_tenths")
	now := sleptAgo(t, app, owner, 2*time.Hour)
	summary, err := wakeRoom(app, owner, now)
	if err != nil || summary == nil {
		t.Fatalf("wake: %+v (%v)", summary, err)
	}
	if summary.Served != 3 || summary.Plates != 3 || summary.Cleared != 0 || summary.ServingsLeft != 7 || summary.Tips != 0 ||
		summary.Coins != 3*cake.PricePerServing || summary.PopularityTo <= summary.PopularityFrom {
		t.Fatalf("summary = %+v", summary)
	}
	after := playerState(t, app, owner)
	if after.GetInt64("gold") != gold+summary.Coins || after.GetInt("satisfaction_current_tenths") != popularity+3 {
		t.Fatalf("gold %d → %d, popularity %d → %d", gold, after.GetInt64("gold"), popularity, after.GetInt("satisfaction_current_tenths"))
	}
}

func TestAbsenceWithAWaiterServesEverythingAndClears(t *testing.T) {
	app, owner, _ := newKitchen(t)
	if err := hireStaff(app, owner, "vostu", ""); err != nil {
		t.Fatal(err)
	}
	addFood(t, app, owner, 10)
	cake := recipe(t, "cake_1")
	now := sleptAgo(t, app, owner, time.Hour)
	summary, err := wakeRoom(app, owner, now)
	if err != nil || summary == nil {
		t.Fatalf("wake: %+v (%v)", summary, err)
	}
	if summary.Served != 10 || summary.Waiters != 1 || summary.Plates != 0 || summary.Cleared != 10 || summary.ServingsLeft != 0 ||
		summary.Tips != 10*gamerules.WaiterTip(cake.PricePerServing) {
		t.Fatalf("summary = %+v", summary)
	}
}

func TestAbsenceIsReplayedOnceAndCapped(t *testing.T) {
	app, owner, _ := newKitchen(t)
	if err := hireStaff(app, owner, "dona_cida", ""); err != nil {
		t.Fatal(err)
	}
	addFood(t, app, owner, 100)
	now := sleptAgo(t, app, owner, 72*time.Hour)
	first, err := wakeRoom(app, owner, now)
	if err != nil || first == nil {
		t.Fatalf("wake: %v", err)
	}
	rules := gamerules.Offline()
	if first.Simulated != int64(rules.MaxAwaySeconds)*1000 || first.Simulated+first.Capped != first.To-first.From {
		t.Fatalf("replayed %d ms and capped %d ms of a 72 h absence", first.Simulated, first.Capped)
	}
	// Three seats turning over every SeatCycleSeconds for 8 h would be 2880 meals:
	// the 100 servings run out, and nothing is credited twice.
	if first.Served != 100 || first.ServingsLeft != 0 {
		t.Fatalf("first wake = %+v", first)
	}
	gold := playerState(t, app, owner).GetInt64("gold")
	second, err := wakeRoom(app, owner, now.Add(time.Second))
	if err != nil || second == nil || second.Served != first.Served || playerState(t, app, owner).GetInt64("gold") != gold {
		t.Fatalf("second wake = %+v (%v)", second, err)
	}
}

func TestAwaySummaryAccumulatesUntilSeen(t *testing.T) {
	app, owner, _ := newKitchen(t)
	if err := hireStaff(app, owner, "vostu", ""); err != nil {
		t.Fatal(err)
	}
	addFood(t, app, owner, 2)
	first, err := wakeRoom(app, owner, sleptAgo(t, app, owner, time.Hour))
	if err != nil || first == nil || first.Served != 2 {
		t.Fatalf("first absence: %+v (%v)", first, err)
	}
	addFood(t, app, owner, 3)
	second, err := wakeRoom(app, owner, sleptAgo(t, app, owner, time.Hour))
	// The time awake between the absences was played live: it is not a cap.
	if err != nil || second == nil || second.Served != 5 || second.From != first.From || second.Capped != 0 {
		t.Fatalf("second absence: %+v (%v)", second, err)
	}
	snapshot, err := snapshotRoom(app, owner)
	if err != nil || snapshot.AwaySummary == nil || snapshot.AwaySummary.Served != 5 {
		t.Fatalf("snapshot summary = %+v (%v)", snapshot.AwaySummary, err)
	}
	if err := acknowledgeAway(app, owner); err != nil {
		t.Fatal(err)
	}
	if snapshot, _ = snapshotRoom(app, owner); snapshot.AwaySummary != nil {
		t.Fatalf("summary after the owner saw it: %+v", snapshot.AwaySummary)
	}
}

func TestLongAbsenceSendsCustomersHome(t *testing.T) {
	app, owner, _ := newKitchen(t)
	npc := gamewire.Actor{ID: "npc:waiting", Kind: "npc", State: "seated", X: 2, Y: 3}
	if err := saveDormantRoom(app, owner, gamewire.Sleep{NPCs: []gamewire.Actor{npc}}); err != nil {
		t.Fatal(err)
	}
	if roomRecord(t, app, owner).GetDateTime("slept_at").IsZero() {
		t.Fatal("sleeping did not stamp slept_at")
	}
	room := roomRecord(t, app, owner)
	room.Set("slept_at", types.NowDateTime().Add(-time.Hour))
	if err := app.Save(room); err != nil {
		t.Fatal(err)
	}
	if _, err := wakeRoom(app, owner, time.Now()); err != nil {
		t.Fatal(err)
	}
	if left, _ := app.CountRecords("room_npcs", dbx.HashExp{"user": owner}); left != 0 {
		t.Fatalf("%d customers still waiting after an hour", left)
	}
}

func TestSleepingRoomLeavesTheSummaryToTheWelcome(t *testing.T) {
	app, owner, _ := newKitchen(t)
	addFood(t, app, owner, 2)
	first, err := wakeRoom(app, owner, sleptAgo(t, app, owner, time.Hour))
	if err != nil || first == nil {
		t.Fatalf("first absence: %+v (%v)", first, err)
	}
	// Not acknowledged, and the café fell asleep again.
	now := sleptAgo(t, app, owner, time.Hour)
	if snapshot, err := snapshotRoom(app, owner); err != nil || snapshot.AwaySummary != nil {
		t.Fatalf("snapshot of a sleeping room = %+v (%v)", snapshot.AwaySummary, err)
	}
	merged, err := wakeRoom(app, owner, now)
	if err != nil || merged == nil || merged.From != first.From {
		t.Fatalf("welcome summary: %+v (%v)", merged, err)
	}
	if snapshot, _ := snapshotRoom(app, owner); snapshot.AwaySummary == nil || snapshot.AwaySummary.To != merged.To {
		t.Fatalf("snapshot after waking = %+v", snapshot.AwaySummary)
	}
}

func TestCafeWithoutADoorStaysClosedOffline(t *testing.T) {
	app, owner, _ := newKitchen(t)
	for _, unit := range placedUnits(t, app, owner) {
		if item, ok := roomcatalog.ByID(unit.GetInt("item_id")); ok && item.Kind == "door" {
			if err := app.Delete(unit); err != nil {
				t.Fatal(err)
			}
		}
	}
	addFood(t, app, owner, 4)
	summary, err := wakeRoom(app, owner, sleptAgo(t, app, owner, time.Hour))
	if err != nil || summary == nil || summary.Served != 0 || summary.ServingsLeft != 4 {
		t.Fatalf("summary = %+v (%v)", summary, err)
	}
}

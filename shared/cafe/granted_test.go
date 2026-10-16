package cafe

import (
	"testing"

	"coffe-mania/shared/gamerules"
)

func TestOldCafesGetExactlyTheirGrantedQuota(t *testing.T) {
	s, _ := newCafe(t, "owner")
	setPlayer(t, s, "owner", map[string]any{"gold": 100000, "level": 10, "experience_current": gamerules.Public().Levels[9].RequiredXP})
	if _, err := ExpandRoom(s, "owner", 10, "coins", progressT0); err != nil {
		t.Fatal(err)
	}
	// Bought after the expansion: one more starter table and two sky floors
	// over default tiles (the default tiles go to the inventory).
	table := catalogItem(t, "white_cloth_table")
	if _, err := buy(t, s, "owner", table.ID, 8, 8); err != nil {
		t.Fatal(err)
	}
	sky := catalogItem(t, "sky_tile_floor")
	for _, x := range []int{2, 3} {
		if _, err := buy(t, s, "owner", sky.ID, x, 2); err != nil {
			t.Fatal(err)
		}
	}
	// An account from before the flag: nothing is marked.
	units, _ := s.Find("player_inventory", Query{Where: Where{"user": "owner"}, Limit: 10000})
	for _, unit := range units {
		unit.Set("granted", false)
		if err := s.Save(unit); err != nil {
			t.Fatal(err)
		}
	}
	marked, err := MarkLegacyGranted(s, "owner")
	if err != nil {
		t.Fatal(err)
	}
	granted := map[int]int{}
	free := map[int]int{}
	units, _ = s.Find("player_inventory", Query{Where: Where{"user": "owner"}, Limit: 10000})
	for _, unit := range units {
		if unit.GetBool("granted") {
			granted[unit.GetInt("item_id")]++
		} else {
			free[unit.GetInt("item_id")]++
		}
	}
	tables := 0
	for _, starter := range starterRoom {
		if starter[0] == table.ID {
			tables++
		}
	}
	if granted[table.ID] != tables || free[table.ID] != 1 {
		t.Fatalf("tables: %d granted, %d free; the starter had %d", granted[table.ID], free[table.ID], tables)
	}
	if granted[defaultFloorID] != 81 || granted[sky.ID] != 0 || free[sky.ID] != 2 {
		t.Fatalf("floors: %d default granted, sky %d granted / %d free", granted[defaultFloorID], granted[sky.ID], free[sky.ID])
	}
	if granted[wallSegmentID] != 18 || granted[wallCornerID] != 1 || granted[3060016] != 18 {
		t.Fatalf("walls: %d segments, %d corner, %d wallpapers", granted[wallSegmentID], granted[wallCornerID], granted[3060016])
	}
	// Idempotent: a marked café changes nothing.
	if again, err := MarkLegacyGranted(s, "owner"); err != nil || again != 0 || marked == 0 {
		t.Fatalf("second pass marked %d (first %d): %v", again, marked, err)
	}
}

func TestNewCafesAreAlreadyMarked(t *testing.T) {
	s, _ := newCafe(t, "owner")
	if marked, err := MarkLegacyGranted(s, "owner"); err != nil || marked != 0 {
		t.Fatalf("a new café marked %d more units: %v", marked, err)
	}
}

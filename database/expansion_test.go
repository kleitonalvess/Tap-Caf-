package main

import (
	"encoding/json"
	"errors"
	"testing"

	"coffe-mania/database/playerstate"
	"coffe-mania/shared/gamewire"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func setCash(t *testing.T, app core.App, owner string, cash int64) {
	t.Helper()
	state, err := playerstate.GetOrCreate(app, owner)
	if err != nil {
		t.Fatal(err)
	}
	state.Set("cash", cash)
	if err = app.Save(state); err != nil {
		t.Fatal(err)
	}
}

// placedAt lists the placed units on one tile by storage layer.
func placedAt(t *testing.T, app core.App, owner string, x, y int) map[string]int {
	t.Helper()
	units, err := app.FindRecordsByFilter("player_inventory", "user={:user} && placed=true && tx={:x} && ty={:y}", "", 0, 0, dbx.Params{"user": owner, "x": x, "y": y})
	if err != nil {
		t.Fatal(err)
	}
	layers := map[string]int{}
	for _, unit := range units {
		layers[unit.GetString("layer")] = unit.GetInt("item_id")
	}
	return layers
}

func TestCoinExpansionNeedsTheLevel(t *testing.T) {
	app, owner, _ := newKitchen(t)
	setGold(t, app, owner, 5000)
	if _, err := expandRoom(app, owner, 10, "coins"); !errors.Is(err, errExpansionLevel) {
		t.Fatalf("level 1 paying coins: %v", err)
	}
	setLevel(t, app, owner, 5)
	setGold(t, app, owner, 1999)
	if _, err := expandRoom(app, owner, 10, "coins"); !errors.Is(err, errExpansionCoins) {
		t.Fatalf("short of coins: %v", err)
	}
	setGold(t, app, owner, 2500)
	result, err := expandRoom(app, owner, 10, "coins")
	if err != nil {
		t.Fatal(err)
	}
	if result.Coins != 2000 || result.Cash != 0 || result.RewardCoins != 250 || result.XP != 20 || result.Room.TilesX != 10 || result.Room.TilesY != 10 {
		t.Fatalf("result = %+v", result)
	}
	state, _ := playerstate.GetOrCreate(app, owner)
	if state.GetInt64("gold") != 750 || state.GetInt64("experience_current") != 20 {
		t.Fatalf("gold=%d xp=%d", state.GetInt64("gold"), state.GetInt64("experience_current"))
	}
	// The same request again names a step the room already has.
	if _, err := expandRoom(app, owner, 10, "coins"); !errors.Is(err, errExpansionStep) {
		t.Fatalf("repeated expansion: %v", err)
	}
}

func TestCashExpansionSkipsTheLevel(t *testing.T) {
	app, owner, _ := newKitchen(t)
	setCash(t, app, owner, 9)
	if _, err := expandRoom(app, owner, 10, "cash"); !errors.Is(err, errExpansionCash) {
		t.Fatalf("short of cash: %v", err)
	}
	setCash(t, app, owner, 300)
	tiles := 8
	for _, step := range []struct {
		tiles int
		cash  int64
	}{{10, 10}, {12, 20}, {14, 35}, {16, 50}, {18, 75}, {20, 100}} {
		result, err := expandRoom(app, owner, step.tiles, "cash")
		if err != nil || result.Cash != step.cash || result.Room.TilesX != step.tiles {
			t.Fatalf("step %d: %+v (%v)", step.tiles, result, err)
		}
		tiles = step.tiles
	}
	if _, err := expandRoom(app, owner, 22, "cash"); !errors.Is(err, errExpansionMax) {
		t.Fatalf("beyond 20x20: %v", err)
	}
	state, _ := playerstate.GetOrCreate(app, owner)
	if state.GetInt64("cash") != 10 || tiles != 20 {
		t.Fatalf("cash left %d", state.GetInt64("cash"))
	}
	// 20x20: 19x19 floors, 19 + 19 wall segments plus the corner, one wallpaper per segment.
	counts := map[string]int{}
	units, _ := app.FindRecordsByFilter("player_inventory", "user={:user} && placed=true", "", 0, 0, dbx.Params{"user": owner})
	for _, unit := range units {
		counts[unit.GetString("layer")]++
	}
	if counts["floor"] != 19*19 || counts["structure"] != 39 || counts["wallpaper"] != 38 {
		t.Fatalf("structure after the last step = %v", counts)
	}
}

func TestNewTilesGetTheCurrentFloorAndWalls(t *testing.T) {
	app, owner, _ := newKitchen(t)
	// The owner dressed the floor and the left wall differently.
	units, err := app.FindRecordsByFilter("player_inventory", "user={:user} && placed=true && (layer='floor' || layer='wallpaper')", "", 0, 0, dbx.Params{"user": owner})
	if err != nil {
		t.Fatal(err)
	}
	for _, unit := range units {
		switch {
		case unit.GetString("layer") == "floor":
			unit.Set("item_id", 9000001)
		case unit.GetInt("rotation")%2 == 0:
			unit.Set("item_id", 9000002)
		}
		if err := app.Save(unit); err != nil {
			t.Fatal(err)
		}
	}
	setCash(t, app, owner, 10)
	if _, err := expandRoom(app, owner, 10, "cash"); err != nil {
		t.Fatal(err)
	}
	if got := placedAt(t, app, owner, 9, 9); got["floor"] != 9000001 || len(got) != 1 {
		t.Fatalf("new corner floor = %v", got)
	}
	if got := placedAt(t, app, owner, 3, 8); got["floor"] != 9000001 {
		t.Fatalf("new front floor = %v", got)
	}
	if got := placedAt(t, app, owner, 0, 9); got["structure"] != 3090000 || got["wallpaper"] != 9000002 {
		t.Fatalf("new left wall = %v", got)
	}
	if got := placedAt(t, app, owner, 9, 0); got["structure"] != 3090000 || got["wallpaper"] != 3060016 {
		t.Fatalf("new right wall = %v", got)
	}
	// Furniture can now go on the new tiles.
	room, _ := app.FindFirstRecordByData("player_rooms", "user", owner)
	revision, x, y, rotation := room.GetInt("revision"), 8, 8, 0
	table := starterTable(t, app, owner)
	if _, err := mutateRoom(app, owner, "move", roomCommand{UnitID: table, TX: &x, TY: &y, Rotation: &rotation, Revision: &revision, RequestID: "move-table-to-new-tile"}); err != nil {
		t.Fatalf("moving onto a new tile: %v", err)
	}
}

func TestExpandOperationReturnsTheGrownWorld(t *testing.T) {
	app, owner, _ := newKitchen(t)
	setCash(t, app, owner, 10)
	body, _ := json.Marshal(map[string]any{"tiles": 10, "pay": "cash"})
	op := gamewire.Operation{Owner: owner, User: owner, Action: "room_expand", Body: body}
	result := persistenceOperation(app, op)
	if result.Status != 200 || result.World == nil || result.World.TilesX != 10 || result.World.TilesY != 10 {
		t.Fatalf("expand: %d %s", result.Status, result.Body)
	}
	if result = persistenceOperation(app, op); result.Status != 409 {
		t.Fatalf("repeated expand: %d %s", result.Status, result.Body)
	}
	op.Body, _ = json.Marshal(map[string]any{"tiles": 12, "pay": "gems"})
	if result = persistenceOperation(app, op); result.Status != 400 {
		t.Fatalf("unknown payment: %d %s", result.Status, result.Body)
	}
	op.User = "visitor"
	if result = persistenceOperation(app, op); result.Status != 403 {
		t.Fatalf("visitor expanding: %d", result.Status)
	}
}

func TestWaiterDeliveryEarnsATip(t *testing.T) {
	app, owner, _ := newKitchen(t)
	food := addFood(t, app, owner, 3)
	plain, err := serveCustomer(app, owner, food, "")
	if err != nil || plain.Tip != 0 {
		t.Fatalf("self-service = %+v (%v)", plain, err)
	}
	tipped, err := serveCustomerBy(app, owner, food, "", true)
	if err != nil || tipped.Tip < 1 || tipped.Coins != plain.Coins+tipped.Tip {
		t.Fatalf("waiter = %+v, self-service = %+v (%v)", tipped, plain, err)
	}
}

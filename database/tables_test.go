package main

import (
	"encoding/json"
	"errors"
	"testing"

	"coffe-mania/shared/gamewire"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// starterTable is the table placed in every new room (catalog id 3030010).
func starterTable(t *testing.T, app core.App, owner string) string {
	t.Helper()
	table, err := app.FindFirstRecordByFilter("player_inventory", "user={:user} && item_id=3030010 && placed=true", dbx.Params{"user": owner})
	if err != nil {
		t.Fatal(err)
	}
	return table.Id
}

func plates(t *testing.T, app core.App, owner string) []gamewire.Dirt {
	t.Helper()
	dirt, err := roomDirt(app, owner)
	if err != nil {
		t.Fatal(err)
	}
	return dirt
}

func TestEveryPaidMealLeavesAPlate(t *testing.T) {
	app, owner, _ := newKitchen(t)
	table := starterTable(t, app, owner)
	food := addFood(t, app, owner, 4)
	for i := 0; i < 2; i++ {
		if _, err := serveCustomer(app, owner, food, table); err != nil {
			t.Fatal(err)
		}
	}
	dirt := plates(t, app, owner)
	if len(dirt) != 1 || dirt[0].TableID != table || dirt[0].Plates != 2 || dirt[0].Since == 0 {
		t.Fatalf("dirt = %+v", dirt)
	}
	world, err := publicWorld(app, owner)
	if err != nil || len(world.Dirt) != 1 {
		t.Fatalf("world dirt = %+v (%v)", world.Dirt, err)
	}
}

func TestUnknownTableStillPaysWithoutAPlate(t *testing.T) {
	app, owner, _ := newKitchen(t)
	payment, err := serveCustomer(app, owner, addFood(t, app, owner, 1), "not-a-table")
	if err != nil || payment.Coins == 0 {
		t.Fatalf("payment = %+v (%v)", payment, err)
	}
	if dirt := plates(t, app, owner); len(dirt) != 0 {
		t.Fatalf("plate on an unknown table: %+v", dirt)
	}
}

func TestCleaningClearsEveryPlateOnce(t *testing.T) {
	app, owner, _ := newKitchen(t)
	table := starterTable(t, app, owner)
	food := addFood(t, app, owner, 4)
	for i := 0; i < 2; i++ {
		if _, err := serveCustomer(app, owner, food, table); err != nil {
			t.Fatal(err)
		}
	}
	cleared, err := cleanTable(app, owner, table, true)
	if err != nil || cleared != 2 || len(plates(t, app, owner)) != 0 {
		t.Fatalf("cleared=%d err=%v dirt=%+v", cleared, err, plates(t, app, owner))
	}
	if _, err = cleanTable(app, owner, table, true); !errors.Is(err, errTableClean) {
		t.Fatalf("cleaning a clean table: %v", err)
	}
	if _, err = cleanTable(app, "someone-else", table, true); !errors.Is(err, errRoomOwned) {
		t.Fatalf("cleaning another player's table: %v", err)
	}
}

func TestDirtyTableCannotMove(t *testing.T) {
	app, owner, _ := newKitchen(t)
	table := starterTable(t, app, owner)
	if _, err := serveCustomer(app, owner, addFood(t, app, owner, 1), table); err != nil {
		t.Fatal(err)
	}
	room, err := app.FindFirstRecordByData("player_rooms", "user", owner)
	if err != nil {
		t.Fatal(err)
	}
	revision := room.GetInt("revision")
	_, err = mutateRoom(app, owner, "store", roomCommand{UnitID: table, Revision: &revision, RequestID: "store-dirty-table-1"})
	if !errors.Is(err, errTableDirty) {
		t.Fatalf("storing a dirty table: %v", err)
	}
}

func TestTableCleanOperation(t *testing.T) {
	app, owner, _ := newKitchen(t)
	table := starterTable(t, app, owner)
	body, _ := json.Marshal(map[string]string{"tableId": table})
	op := gamewire.Operation{Owner: owner, User: owner, Action: "table_clean", Body: body}
	if result := persistenceOperation(app, op); result.Status != 409 {
		t.Fatalf("clean table: %d %s", result.Status, result.Body)
	}
	if _, err := serveCustomer(app, owner, addFood(t, app, owner, 1), table); err != nil {
		t.Fatal(err)
	}
	result := persistenceOperation(app, op)
	if result.Status != 200 || result.World == nil || len(result.World.Dirt) != 0 {
		t.Fatalf("cleaning: %d %s", result.Status, result.Body)
	}
	op.User = "visitor"
	if result = persistenceOperation(app, op); result.Status != 403 {
		t.Fatalf("visitor cleaning: %d", result.Status)
	}
}

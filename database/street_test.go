package main

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func roomRecord(t *testing.T, app core.App, owner string) *core.Record {
	t.Helper()
	room, err := app.FindFirstRecordByData("player_rooms", "user", owner)
	if err != nil {
		t.Fatal(err)
	}
	return room
}

func TestFarmHarvestGivesOneChargePerCooldown(t *testing.T) {
	app, owner, _ := newKitchen(t)
	t0 := types.NowDateTime()
	street, err := harvestFarm(app, owner, t0)
	if err != nil || street.FreshCharges != 1 || street.FarmReadyAt != t0.Add(gamerules.FarmCooldown()).Time().UnixMilli() {
		t.Fatalf("harvest = %+v (%v)", street, err)
	}
	if _, err := harvestFarm(app, owner, t0.Add(time.Minute)); !errors.Is(err, errFarmGrowing) {
		t.Fatalf("harvest before the cooldown: %v", err)
	}
	// Ready again, but the charge was not used yet.
	if _, err := harvestFarm(app, owner, t0.Add(gamerules.FarmCooldown())); !errors.Is(err, errFarmFull) {
		t.Fatalf("harvest while holding the charge: %v", err)
	}
}

func TestFreshBatchPaysTheBonusOnEveryServing(t *testing.T) {
	app, owner, stove := newKitchen(t)
	pao := recipe(t, "pao_de_queijo")
	t0 := types.NowDateTime()
	if _, err := harvestFarm(app, owner, t0); err != nil {
		t.Fatal(err)
	}
	if err := startCooking(app, owner, stove, pao.ID, t0); err != nil {
		t.Fatal(err)
	}
	job, err := app.FindFirstRecordByData("stove_cooking", "stove", stove)
	if err != nil || !job.GetBool("fresh") || roomRecord(t, app, owner).GetInt("fresh_charges") != 0 {
		t.Fatalf("the batch did not take the fresh charge (%v)", err)
	}
	snapshot, _ := snapshotCooking(app, owner, t0)
	if len(snapshot.Stoves) == 0 || snapshot.Stoves[0].Cooking == nil || !snapshot.Stoves[0].Cooking.Fresh {
		t.Fatalf("cooking snapshot hides the fresh batch: %+v", snapshot.Stoves)
	}
	if err := serveCooking(app, owner, stove, readyAt(t0, pao)); err != nil {
		t.Fatal(err)
	}
	foods, _ := app.FindRecordsByFilter("room_food", "user={:user}", "", 0, 0, dbx.Params{"user": owner})
	if len(foods) != 1 || foods[0].GetInt("fresh_servings") != pao.Servings {
		t.Fatalf("fresh servings on the counter = %+v", foods)
	}
	for i := 0; i < pao.Servings; i++ {
		payment, err := serveCustomer(app, owner, foods[0].Id, "")
		if err != nil {
			t.Fatal(err)
		}
		if payment.FreshCoins != gamerules.FreshBonus(pao.PricePerServing) || payment.FreshXP != gamerules.FreshBonus(pao.XPPerServing) ||
			payment.Coins != pao.PricePerServing+payment.FreshCoins || payment.FreshLeft != max(0, pao.Servings-i-1) {
			t.Fatalf("serving %d = %+v", i, payment)
		}
	}
}

func TestCancelledFreshBatchReturnsTheCharge(t *testing.T) {
	app, owner, stove := newKitchen(t)
	t0 := types.NowDateTime()
	if _, err := harvestFarm(app, owner, t0); err != nil {
		t.Fatal(err)
	}
	if err := startCooking(app, owner, stove, "pao_de_queijo", t0); err != nil {
		t.Fatal(err)
	}
	if err := cancelCooking(app, owner, stove, t0.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if got := roomRecord(t, app, owner).GetInt("fresh_charges"); got != 1 {
		t.Fatalf("charges after cancelling = %d", got)
	}
}

func TestPartyRunsThenRests(t *testing.T) {
	app, owner, _ := newKitchen(t)
	t0 := types.NowDateTime()
	street, err := startParty(app, owner, t0)
	if err != nil || !street.PartyActive(t0.Time().UnixMilli()) || street.PartyEndsAt-street.PartyStartedAt != gamerules.PartyDuration().Milliseconds() {
		t.Fatalf("party = %+v (%v)", street, err)
	}
	if _, err := startParty(app, owner, t0.Add(time.Minute)); !errors.Is(err, errPartyOn) {
		t.Fatalf("second party during the first: %v", err)
	}
	afterParty := t0.Add(gamerules.PartyDuration() + time.Second)
	if _, err := startParty(app, owner, afterParty); !errors.Is(err, errPartyResting) {
		t.Fatalf("party during the rest: %v", err)
	}
	if _, err := startParty(app, owner, t0.Add(gamerules.PartyDuration()+gamerules.PartyCooldown())); err != nil {
		t.Fatalf("party after the rest: %v", err)
	}
}

func TestPartyMultipliesTips(t *testing.T) {
	app, owner, _ := newKitchen(t)
	food := addFood(t, app, owner, 4)
	pao := recipe(t, "cake_1")
	before, err := serveCustomer(app, owner, food, "")
	if err != nil || before.Tip != 0 {
		t.Fatalf("self-service before the party = %+v (%v)", before, err)
	}
	if _, err := startParty(app, owner, types.NowDateTime()); err != nil {
		t.Fatal(err)
	}
	self, err := serveCustomer(app, owner, food, "")
	if err != nil || self.Tip != gamerules.WaiterTip(pao.PricePerServing) {
		t.Fatalf("self-service during the party = %+v (%v)", self, err)
	}
	waiter, err := serveCustomerBy(app, owner, food, "", true)
	if err != nil || waiter.Tip != gamerules.WaiterTip(pao.PricePerServing)*gamerules.Street().Disco.TipMultiplier {
		t.Fatalf("waiter during the party = %+v (%v)", waiter, err)
	}
}

func TestStreetOperationsReturnTheWorld(t *testing.T) {
	app, owner, _ := newKitchen(t)
	op := gamewire.Operation{Owner: owner, User: owner, Action: "farm_harvest", Body: json.RawMessage(`{}`)}
	result := persistenceOperation(app, op)
	if result.Status != 200 || result.World == nil || result.World.Street == nil || result.World.Street.FreshCharges != 1 {
		t.Fatalf("harvest: %d %s", result.Status, result.Body)
	}
	if result = persistenceOperation(app, op); result.Status != 409 {
		t.Fatalf("second harvest: %d %s", result.Status, result.Body)
	}
	op.Action = "party_start"
	if result = persistenceOperation(app, op); result.Status != 200 || result.World.Street.PartyEndsAt == 0 {
		t.Fatalf("party: %d %s", result.Status, result.Body)
	}
	op.User = "visitor"
	if result = persistenceOperation(app, op); result.Status != 403 {
		t.Fatalf("visitor party: %d", result.Status)
	}
	snapshot, err := snapshotRoom(app, owner)
	if err != nil || snapshot.Street.FreshCharges != 1 || snapshot.Street.PartyEndsAt == 0 {
		t.Fatalf("room snapshot street = %+v (%v)", snapshot.Street, err)
	}
}

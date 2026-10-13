package main

import (
	"errors"
	"testing"

	"coffe-mania/database/playerstate"
	"coffe-mania/shared/gamerules"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
)

// newEconomyApp migrates an empty temporary database with the project migrations.
func newEconomyApp(t *testing.T) (*tests.TestApp, string) {
	t.Helper()
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
	playerstate.RegisterValidation(app)
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(users)
	user.SetEmail("economy@local.mail")
	user.SetPassword("123456")
	if err = app.Save(user); err != nil {
		t.Fatal(err)
	}
	if _, err = playerstate.GetOrCreate(app, user.Id); err != nil {
		t.Fatal(err)
	}
	return app, user.Id
}

func playerState(t *testing.T, app core.App, owner string) *core.Record {
	t.Helper()
	record, err := app.FindFirstRecordByData(playerstate.Collection, "user", owner)
	if err != nil {
		t.Fatal(err)
	}
	return record
}

func addFood(t *testing.T, app core.App, owner string, servings int) string {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("room_food")
	if err != nil {
		t.Fatal(err)
	}
	food := core.NewRecord(collection)
	food.Load(map[string]any{"user": owner, "recipe_id": "cake_1", "job_id": core.GenerateDefaultRandomId(), "servings": servings})
	if err = app.Save(food); err != nil {
		t.Fatal(err)
	}
	return food.Id
}

func TestNewPlayersStartWithoutPlaceholderExperience(t *testing.T) {
	app, owner := newEconomyApp(t)
	state := playerState(t, app, owner)
	if state.GetInt("level") != 1 || state.GetInt64("experience_current") != 0 || state.GetInt64("experience_max") != gamerules.NextLevelXP(1) {
		t.Fatalf("starter experience = %d/%d at level %d", state.GetInt64("experience_current"), state.GetInt64("experience_max"), state.GetInt("level"))
	}
	levelField := state.Collection().Fields.GetByName("level").(*core.NumberField)
	if levelField.Max == nil || *levelField.Max < float64(gamerules.MaxLevel()) {
		t.Fatalf("player_state.level cannot store level %d", gamerules.MaxLevel())
	}
}

func TestServeCustomerTakesServingsAndPays(t *testing.T) {
	app, owner := newEconomyApp(t)
	cake, _ := gamerules.RecipeByID("cake_1")
	before := playerState(t, app, owner)
	gold, popularity := before.GetInt64("gold"), before.GetInt("satisfaction_current_tenths")
	foodID := addFood(t, app, owner, 2)

	first, err := serveCustomer(app, owner, foodID)
	if err != nil {
		t.Fatal(err)
	}
	if first.ServingsLeft != 1 || first.Coins != cake.PricePerServing || first.XP != cake.XPPerServing {
		t.Fatalf("first payment = %+v", first)
	}
	if _, err = serveCustomer(app, owner, foodID); err != nil {
		t.Fatal(err)
	}
	if _, err = app.FindRecordById("room_food", foodID); err == nil {
		t.Fatal("an empty dish stayed in the room")
	}
	if _, err = serveCustomer(app, owner, foodID); !errors.Is(err, errFoodGone) {
		t.Fatalf("third serving error = %v, want errFoodGone", err)
	}
	after := playerState(t, app, owner)
	if after.GetInt64("gold") != gold+2*cake.PricePerServing {
		t.Fatalf("gold = %d, want %d", after.GetInt64("gold"), gold+2*cake.PricePerServing)
	}
	if after.GetInt64("experience_current") != 2*cake.XPPerServing {
		t.Fatalf("experience = %d", after.GetInt64("experience_current"))
	}
	if after.GetInt("satisfaction_current_tenths") != gamerules.ApplyCustomer(gamerules.ApplyCustomer(popularity, true), true) {
		t.Fatalf("popularity = %d", after.GetInt("satisfaction_current_tenths"))
	}
}

func TestServeCustomerRejectsAnotherOwnersDish(t *testing.T) {
	app, owner := newEconomyApp(t)
	foodID := addFood(t, app, owner, 1)
	if _, err := serveCustomer(app, "someone-else", foodID); !errors.Is(err, errFoodGone) {
		t.Fatalf("foreign dish error = %v", err)
	}
	if _, err := app.FindRecordById("room_food", foodID); err != nil {
		t.Fatal("a foreign request consumed the dish")
	}
}

func TestLevelUpGrantsRewardCoins(t *testing.T) {
	app, owner := newEconomyApp(t)
	state := playerState(t, app, owner)
	state.Set("experience_current", gamerules.NextLevelXP(1)-1)
	if err := app.Save(state); err != nil {
		t.Fatal(err)
	}
	gold := state.GetInt64("gold")
	payment, err := serveCustomer(app, owner, addFood(t, app, owner, 1))
	if err != nil {
		t.Fatal(err)
	}
	if !payment.LevelUp || payment.Level != 2 || payment.LevelReward != gamerules.LevelRewards(1, 2) {
		t.Fatalf("level-up payment = %+v", payment)
	}
	after := playerState(t, app, owner)
	if after.GetInt("level") != 2 || after.GetInt64("experience_max") != gamerules.NextLevelXP(2) ||
		after.GetInt64("gold") != gold+payment.Coins+payment.LevelReward {
		t.Fatalf("after level-up: level=%d max=%d gold=%d", after.GetInt("level"), after.GetInt64("experience_max"), after.GetInt64("gold"))
	}
}

func TestUnsatisfiedVerdictLowersPopularity(t *testing.T) {
	app, owner := newEconomyApp(t)
	before := playerState(t, app, owner).GetInt("satisfaction_current_tenths")
	value, err := recordVerdict(app, owner, false)
	if err != nil {
		t.Fatal(err)
	}
	if want := gamerules.ApplyCustomer(before, false); value != want || playerState(t, app, owner).GetInt("satisfaction_current_tenths") != want {
		t.Fatalf("popularity = %d, want %d", value, want)
	}
}

func TestStartCookingChargesRecipeCost(t *testing.T) {
	app, owner := newEconomyApp(t)
	if err := ensureStarterStove(app, owner); err != nil {
		t.Fatal(err)
	}
	stove, err := app.FindFirstRecordByData("player_stoves", "user", owner)
	if err != nil {
		t.Fatal(err)
	}
	cake, _ := gamerules.RecipeByID("cake_1")
	state := playerState(t, app, owner)
	state.Set("gold", cake.CostCoins-1)
	if err = app.Save(state); err != nil {
		t.Fatal(err)
	}
	if cake.CostCoins > 0 {
		if err = startCooking(app, owner, stove.Id, cake.ID, types.NowDateTime()); !errors.Is(err, errCookingCoins) {
			t.Fatalf("poor start error = %v", err)
		}
	}
	state.Set("gold", cake.CostCoins+10)
	if err = app.Save(state); err != nil {
		t.Fatal(err)
	}
	if err = startCooking(app, owner, stove.Id, cake.ID, types.NowDateTime()); err != nil {
		t.Fatal(err)
	}
	if got := playerState(t, app, owner).GetInt64("gold"); got != 10 {
		t.Fatalf("gold after start = %d, want 10", got)
	}
	// An occupied stove must not charge again.
	if err = startCooking(app, owner, stove.Id, cake.ID, types.NowDateTime()); !errors.Is(err, errStoveOccupied) {
		t.Fatalf("second start error = %v", err)
	}
	if got := playerState(t, app, owner).GetInt64("gold"); got != 10 {
		t.Fatalf("occupied stove charged gold: %d", got)
	}
	if err = startCooking(app, owner, stove.Id, "missing", types.NowDateTime()); !errors.Is(err, errUnknownRecipe) {
		t.Fatalf("unknown recipe error = %v", err)
	}
}

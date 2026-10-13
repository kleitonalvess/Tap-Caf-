package main

import (
	"errors"
	"testing"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// newKitchen provisions a starter room: one stove at (6,2) and one counter at (7,3).
func newKitchen(t *testing.T) (core.App, string, string) {
	t.Helper()
	app, owner := newEconomyApp(t)
	if err := ensureRoom(app, owner); err != nil {
		t.Fatal(err)
	}
	stove, err := app.FindFirstRecordByData("player_stoves", "user", owner)
	if err != nil {
		t.Fatal(err)
	}
	return app, owner, stove.Id
}

func setGold(t *testing.T, app core.App, owner string, gold int64) {
	t.Helper()
	state := playerState(t, app, owner)
	state.Set("gold", gold)
	if err := app.Save(state); err != nil {
		t.Fatal(err)
	}
}

func recipe(t *testing.T, id string) gamerules.Recipe {
	t.Helper()
	r, ok := gamerules.RecipeByID(id)
	if !ok {
		t.Fatalf("recipe %s missing", id)
	}
	return r
}

// readyAt is when a batch started at t0 can be served.
func readyAt(t0 types.DateTime, r gamerules.Recipe) types.DateTime {
	return t0.Add(gamerules.PrepareDuration() + r.CookDuration())
}

func TestEmergencyRecipeIsFreeOnlyWhenBroke(t *testing.T) {
	app, owner, stove := newKitchen(t)
	cheapest, _ := gamerules.CheapestRecipe(1)
	t0 := types.NowDateTime()

	setGold(t, app, owner, 50)
	snapshot, err := snapshotCooking(app, owner, t0)
	if err != nil || snapshot.EmergencyRecipeID != "" {
		t.Fatalf("emergency offered with coins: %q %v", snapshot.EmergencyRecipeID, err)
	}

	setGold(t, app, owner, cheapest.CostCoins-1)
	if snapshot, _ = snapshotCooking(app, owner, t0); snapshot.EmergencyRecipeID != cheapest.ID {
		t.Fatalf("emergency recipe = %q, want %q", snapshot.EmergencyRecipeID, cheapest.ID)
	}
	if err = startCooking(app, owner, stove, "cake_1", t0); !errors.Is(err, errCookingCoins) {
		t.Fatalf("a non-emergency recipe was free: %v", err)
	}
	if err = startCooking(app, owner, stove, cheapest.ID, t0); err != nil {
		t.Fatal(err)
	}
	if gold := playerState(t, app, owner).GetInt64("gold"); gold != cheapest.CostCoins-1 {
		t.Fatalf("emergency batch charged: gold = %d", gold)
	}
	// Something is cooking: no second free batch.
	if snapshot, _ = snapshotCooking(app, owner, t0); snapshot.EmergencyRecipeID != "" {
		t.Fatal("emergency still offered while cooking")
	}
	// Served to the counter: still not broke in practice.
	if err = serveCooking(app, owner, stove, readyAt(t0, cheapest)); err != nil {
		t.Fatal(err)
	}
	if snapshot, _ = snapshotCooking(app, owner, readyAt(t0, cheapest)); snapshot.EmergencyRecipeID != "" {
		t.Fatal("emergency offered with food on the counter")
	}
}

func TestSpoiledDishMustBeCleaned(t *testing.T) {
	app, owner, stove := newKitchen(t)
	cake := recipe(t, "cake_1")
	t0 := types.NowDateTime()
	if err := startCooking(app, owner, stove, cake.ID, t0); err != nil {
		t.Fatal(err)
	}
	spoiled := readyAt(t0, cake).Add(cake.SpoilDuration() + time.Second)
	snapshot, _ := snapshotCooking(app, owner, spoiled)
	if snapshot.Stoves[0].Cooking == nil || snapshot.Stoves[0].Cooking.Status != "spoiled" {
		t.Fatalf("status after the spoil window = %+v", snapshot.Stoves[0].Cooking)
	}
	if err := serveCooking(app, owner, stove, spoiled); !errors.Is(err, errDishSpoiled) {
		t.Fatalf("serving a spoiled dish: %v", err)
	}
	if err := startCooking(app, owner, stove, cake.ID, spoiled); !errors.Is(err, errStoveDirty) {
		t.Fatalf("cooking on a dirty stove: %v", err)
	}
	xp := playerState(t, app, owner).GetInt64("experience_current")
	if err := cleanStove(app, owner, stove, spoiled); err != nil {
		t.Fatal(err)
	}
	if got := playerState(t, app, owner).GetInt64("experience_current"); got != xp+gamerules.Stove().CleaningXP {
		t.Fatalf("cleaning XP = %d, want %d", got-xp, gamerules.Stove().CleaningXP)
	}
	if err := cleanStove(app, owner, stove, spoiled); !errors.Is(err, errNothingToClean) {
		t.Fatalf("second clean: %v", err)
	}
	if err := startCooking(app, owner, stove, cake.ID, spoiled); err != nil {
		t.Fatalf("clean stove refused a recipe: %v", err)
	}
}

func TestReadyDishCannotBeCleaned(t *testing.T) {
	app, owner, stove := newKitchen(t)
	cake := recipe(t, "cake_1")
	t0 := types.NowDateTime()
	if err := startCooking(app, owner, stove, cake.ID, t0); err != nil {
		t.Fatal(err)
	}
	if err := cleanStove(app, owner, stove, readyAt(t0, cake)); !errors.Is(err, errNothingToClean) {
		t.Fatalf("a fresh dish was thrown away: %v", err)
	}
}

func TestServingMergesSameRecipeOnACounter(t *testing.T) {
	app, owner, stove := newKitchen(t)
	pao := recipe(t, "pao_de_queijo")
	t0 := types.NowDateTime()
	for batch := 0; batch < 2; batch++ {
		start := t0.Add(time.Duration(batch) * time.Hour)
		if err := startCooking(app, owner, stove, pao.ID, start); err != nil {
			t.Fatal(err)
		}
		if err := serveCooking(app, owner, stove, readyAt(start, pao)); err != nil {
			t.Fatal(err)
		}
	}
	foods, err := app.FindRecordsByFilter("room_food", "user={:user}", "", 0, 0, dbx.Params{"user": owner})
	if err != nil || len(foods) != 1 {
		t.Fatalf("foods = %d, %v", len(foods), err)
	}
	if foods[0].GetInt("servings") != 2*pao.Servings || foods[0].GetString("counter") == "" {
		t.Fatalf("counter dish: servings=%d counter=%q", foods[0].GetInt("servings"), foods[0].GetString("counter"))
	}
	// The only counter holds another recipe.
	later := t0.Add(3 * time.Hour)
	cake := recipe(t, "cake_1")
	if err := startCooking(app, owner, stove, cake.ID, later); err != nil {
		t.Fatal(err)
	}
	if err := serveCooking(app, owner, stove, readyAt(later, cake)); !errors.Is(err, errNoCounter) {
		t.Fatalf("served without a free counter: %v", err)
	}
}

func TestCounterWithFoodCannotMove(t *testing.T) {
	app, owner, stove := newKitchen(t)
	pao := recipe(t, "pao_de_queijo")
	t0 := types.NowDateTime()
	if err := startCooking(app, owner, stove, pao.ID, t0); err != nil {
		t.Fatal(err)
	}
	if err := serveCooking(app, owner, stove, readyAt(t0, pao)); err != nil {
		t.Fatal(err)
	}
	food, err := app.FindFirstRecordByData("room_food", "user", owner)
	if err != nil {
		t.Fatal(err)
	}
	room, err := app.FindFirstRecordByData("player_rooms", "user", owner)
	if err != nil {
		t.Fatal(err)
	}
	revision, x, y, rotation := room.GetInt("revision"), 7, 4, 0
	_, err = mutateRoom(app, owner, "move", roomCommand{UnitID: food.GetString("counter"), TX: &x, TY: &y, Rotation: &rotation, Revision: &revision, RequestID: "move-counter-with-food-1"})
	if !errors.Is(err, errCounterBusy) {
		t.Fatalf("moving a counter with food: %v", err)
	}
}

func TestSeasoningAddsServingsOnce(t *testing.T) {
	app, owner, stove := newKitchen(t)
	cake := recipe(t, "cake_1")
	t0 := types.NowDateTime()
	if err := startCooking(app, owner, stove, cake.ID, t0); err != nil {
		t.Fatal(err)
	}
	// A visitor seasons the owner's stove and earns the XP.
	users, _ := app.FindCollectionByNameOrId("users")
	visitor := core.NewRecord(users)
	visitor.SetEmail("visitor@local.mail")
	visitor.SetPassword("123456")
	if err := app.Save(visitor); err != nil {
		t.Fatal(err)
	}
	cooking := t0.Add(gamerules.PrepareDuration() + time.Second)
	if err := seasonCooking(app, owner, visitor.Id, stove, cooking); err != nil {
		t.Fatal(err)
	}
	if err := seasonCooking(app, owner, owner, stove, cooking); !errors.Is(err, errAlreadySeasoned) {
		t.Fatalf("second seasoning: %v", err)
	}
	if got := playerState(t, app, visitor.Id).GetInt64("experience_current"); got != gamerules.Stove().SeasonXP {
		t.Fatalf("visitor XP = %d", got)
	}
	snapshot, _ := snapshotCooking(app, owner, cooking)
	want := cake.Servings + gamerules.SeasonBonus(cake.Servings)
	if job := snapshot.Stoves[0].Cooking; job == nil || !job.Seasoned || job.Servings != want {
		t.Fatalf("seasoned job = %+v, want %d servings", job, want)
	}
	if err := serveCooking(app, owner, stove, readyAt(t0, cake)); err != nil {
		t.Fatal(err)
	}
	food, err := app.FindFirstRecordByData("room_food", "user", owner)
	if err != nil || food.GetInt("servings") != want {
		t.Fatalf("served servings = %d, want %d (%v)", food.GetInt("servings"), want, err)
	}
	// Too late once the dish is ready.
	later := t0.Add(time.Hour)
	if err := startCooking(app, owner, stove, cake.ID, later); err != nil {
		t.Fatal(err)
	}
	if err := seasonCooking(app, owner, owner, stove, readyAt(later, cake)); !errors.Is(err, errSeasonClosed) {
		t.Fatalf("seasoning a ready dish: %v", err)
	}
}

func TestVisitorsCannotDoOtherCookingActions(t *testing.T) {
	app, owner, stove := newKitchen(t)
	body := []byte(`{"stoveId":"` + stove + `","recipeId":"cake_1"}`)
	result := persistenceOperation(app, gamewire.Operation{Owner: owner, User: "someone-else", Action: "cook_start", Body: body})
	if result.Status != 403 {
		t.Fatalf("visitor started cooking: %d %s", result.Status, result.Body)
	}
}

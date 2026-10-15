package cafe

import (
	"errors"
	"testing"
	"time"

	"coffe-mania/shared/gamerules"
)

// fixedDraws makes RandomIntn return the given values in turn (then zeros).
func fixedDraws(t *testing.T, values ...int) {
	t.Helper()
	previous := RandomIntn
	t.Cleanup(func() { RandomIntn = previous })
	RandomIntn = func(n int) int {
		if len(values) == 0 {
			return 0
		}
		value := values[0] % n
		values = values[1:]
		return value
	}
}

func pantryOf(t *testing.T, s Store, user string) map[int]int {
	t.Helper()
	state, err := GetOrCreatePlayer(s, user)
	if err != nil {
		t.Fatal(err)
	}
	return readPantry(state)
}

func TestBuySpiceFillsThePantry(t *testing.T) {
	s, _ := newCafe(t, "owner")
	spice, _ := gamerules.SpiceByCode(800002)
	setPlayer(t, s, "owner", map[string]any{"gold": spice.PriceCoins - 1})
	if _, err := BuySpice(s, "owner", spice.Code, progressT0); !errors.Is(err, ErrSpiceCoins) {
		t.Fatalf("too poor: %v", err)
	}
	if _, err := BuySpice(s, "owner", 799999, progressT0); !errors.Is(err, ErrSpiceUnknown) {
		t.Fatalf("unknown spice: %v", err)
	}
	setPlayer(t, s, "owner", map[string]any{"gold": spice.PriceCoins})
	result, err := BuySpice(s, "owner", spice.Code, progressT0)
	if err != nil || result.State.Gold != 0 || result.State.Pantry["800002"] != 1 {
		t.Fatalf("buy: %+v %v", result.State, err)
	}
	for _, view := range result.Pantry.Spices {
		if view.Code == spice.Code && view.Count != 1 {
			t.Fatalf("pantry view %+v", view)
		}
	}
}

func TestSpicesChangeTheBatch(t *testing.T) {
	recipe, _ := gamerules.RecipeByID("coxinha")
	for _, spice := range gamerules.Spices() {
		t.Run(spice.Effect, func(t *testing.T) {
			s, stove := newCafe(t, "owner")
			setPlayer(t, s, "owner", map[string]any{"gold": 1000, "level": recipe.Level, "experience_current": gamerules.Public().Levels[recipe.Level-1].RequiredXP})
			if err := SeasonCooking(s, "owner", "owner", stove, spice.Code, progressT0); !errors.Is(err, ErrSeasonClosed) {
				t.Fatalf("no batch: %v", err)
			}
			if err := StartCooking(s, "owner", stove, recipe.ID, progressT0); err != nil {
				t.Fatal(err)
			}
			at := progressT0.Add(gamerules.PrepareDuration() + 20*time.Second)
			if err := SeasonCooking(s, "owner", "owner", stove, spice.Code, at); !errors.Is(err, ErrSpiceEmpty) {
				t.Fatalf("empty pantry: %v", err)
			}
			state, _ := GetOrCreatePlayer(s, "owner")
			addSpices(state, spice.Code, 1)
			if err := s.Save(state); err != nil {
				t.Fatal(err)
			}
			before, _ := s.First("stove_cooking", Where{"stove": stove})
			ready, spoils := before.GetTime("ready_at"), before.GetTime("spoils_at")
			if err := SeasonCooking(s, "owner", "owner", stove, spice.Code, at); err != nil {
				t.Fatal(err)
			}
			job, _ := s.First("stove_cooking", Where{"stove": stove})
			regular := gamerules.SeasonBonus(recipe.Servings)
			switch spice.Effect {
			case gamerules.SpiceDouble:
				if job.GetInt("bonus_servings") != 2*regular {
					t.Fatalf("double: %d extra servings, want %d", job.GetInt("bonus_servings"), 2*regular)
				}
			case gamerules.SpiceRush:
				left := ready.Sub(at)
				if got := job.GetTime("ready_at"); !got.Equal(ready.Add(-left/2)) || !job.GetTime("spoils_at").Equal(spoils.Add(-left/2)) {
					t.Fatalf("rush: ready %v → %v", ready, got)
				}
			case gamerules.SpicePreserve:
				if got := job.GetTime("spoils_at").Sub(job.GetTime("ready_at")); got != 3*spoils.Sub(ready) {
					t.Fatalf("preserve: window %v", got)
				}
			}
			if pantryOf(t, s, "owner")[spice.Code] != 0 {
				t.Fatal("the spice was not used up")
			}
			cooking, _ := SnapshotCooking(s, "owner", at)
			if cooking.Stoves[0].Cooking.Spice != spice.Code {
				t.Fatalf("snapshot spice = %d", cooking.Stoves[0].Cooking.Spice)
			}
		})
	}
}

func TestVisitorsCannotUseThePantry(t *testing.T) {
	s, stove := newCafe(t, "owner")
	if err := StartCooking(s, "owner", stove, "pao_de_queijo", progressT0); err != nil {
		t.Fatal(err)
	}
	friend, _ := GetOrCreatePlayer(s, "friend")
	addSpices(friend, 800001, 1)
	if err := s.Save(friend); err != nil {
		t.Fatal(err)
	}
	if err := SeasonCooking(s, "owner", "friend", stove, 800001, progressT0.Add(time.Second)); !errors.Is(err, ErrSpiceOwner) {
		t.Fatalf("visitor spice: %v", err)
	}
	if pantryOf(t, s, "friend")[800001] != 1 {
		t.Fatal("a refused spice was used up")
	}
}

func TestOpenCratePaysDrawsAndRemembers(t *testing.T) {
	s, _ := newCafe(t, "owner")
	state, _ := GetOrCreatePlayer(s, "owner")
	if state.GetInt("crates_current") != 4 || state.GetInt("crates_max") != gamerules.CrateRulesNow().FreeMax {
		t.Fatalf("new account crates %d/%d", state.GetInt("crates_current"), state.GetInt("crates_max"))
	}
	surprise, _ := gamerules.CrateByID("surprise")
	// Draw the spice prize of the free crate (weights 4, 2, then the spice).
	fixedDraws(t, 6)
	result, err := OpenCrate(s, "owner", "surprise", "request-free-000001", progressT0)
	if err != nil || result.Prize.Spice != surprise.Prizes[2].Spice || result.State.Crates.Current != 3 {
		t.Fatalf("free crate: %+v %v", result, err)
	}
	if pantryOf(t, s, "owner")[surprise.Prizes[2].Spice] != 1 {
		t.Fatal("the spice prize did not reach the pantry")
	}
	// A repeated request answers the same prize without paying again.
	again, err := OpenCrate(s, "owner", "surprise", "request-free-000001", progressT0)
	if err != nil || again.Prize.Name != result.Prize.Name || again.State.Crates.Current != 3 {
		t.Fatalf("repeat: %+v %v", again, err)
	}
	if _, err := OpenCrate(s, "owner", "brown", "request-free-000001", progressT0); !errors.Is(err, ErrCrateRequest) {
		t.Fatalf("reused key for another crate: %v", err)
	}
	// Grana crate with an item prize: the item lands in the inventory.
	purple, _ := gamerules.CrateByID("purple")
	setPlayer(t, s, "owner", map[string]any{"cash": purple.Cash - 1})
	if _, err := OpenCrate(s, "owner", "purple", "request-purple-0001", progressT0); !errors.Is(err, ErrCrateCash) {
		t.Fatalf("too little Grana: %v", err)
	}
	setPlayer(t, s, "owner", map[string]any{"cash": purple.Cash})
	fixedDraws(t, 0)
	item, err := OpenCrate(s, "owner", "purple", "request-purple-0002", progressT0)
	if err != nil || item.Prize.Item != purple.Prizes[0].Item || item.Prize.UnitID == "" || item.State.Cash != 0 {
		t.Fatalf("item crate: %+v %v", item, err)
	}
	unit, err := s.Get("player_inventory", item.Prize.UnitID)
	if err != nil || unit.GetBool("placed") || unit.GetInt("item_id") != purple.Prizes[0].Item || unit.GetString("user") != "owner" {
		t.Fatalf("prize unit: %v", err)
	}
	// Free crates run out.
	setPlayer(t, s, "owner", map[string]any{"crates_current": 0})
	if _, err := OpenCrate(s, "owner", "surprise", "request-free-000002", progressT0); !errors.Is(err, ErrCrateEmpty) {
		t.Fatalf("no free crate: %v", err)
	}
}

func TestTrioOfMissionsFillsAFreeCrate(t *testing.T) {
	s, _ := newCafe(t, "owner")
	setPlayer(t, s, "owner", map[string]any{"crates_current": 0})
	missions := DailyMissions("owner", bonusDate(progressT0))
	if err := s.Transaction(func(tx Store) error {
		for _, m := range missions {
			if err := count(tx, "owner", progressT0, m.Goals[0].Stat, m.Goals[0].Target); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var last ProgressClaim
	for _, m := range missions {
		claim, err := ClaimMission(s, "owner", m.ID, progressT0)
		if err != nil {
			t.Fatal(err)
		}
		last = claim
	}
	if !last.FreeCrate || last.State.Crates.Current != 1 {
		t.Fatalf("trio crate: %v, crates %v", last.FreeCrate, last.State.Crates)
	}
}

func TestDailyBonusDaysFiveAndSixGiveASpice(t *testing.T) {
	if gamerules.DailyRewardFor(5).Spices != 1 || gamerules.DailyRewardFor(6).Spices != 1 {
		t.Fatal("days 5 and 6 should give a spice")
	}
	s, _ := newCafe(t, "owner")
	state, _ := GetOrCreatePlayer(s, "owner")
	state.Set("daily_claimed_on", bonusDate(progressT0.Add(-24*time.Hour)))
	state.Set("daily_streak", 4)
	if err := s.Save(state); err != nil {
		t.Fatal(err)
	}
	fixedDraws(t, 2)
	claim, err := ClaimDaily(s, "owner", progressT0)
	if err != nil || claim.Reward.Day != 5 || len(claim.Spices) != 1 || claim.State.Pantry["800003"] != 1 {
		t.Fatalf("day 5: %+v %v", claim, err)
	}
}

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
		if spice.Effect == gamerules.SpiceRescue {
			continue
		}
		t.Run(spice.Name, func(t *testing.T) {
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
			left := ready.Sub(at)
			switch spice.Effect {
			case gamerules.SpiceServings:
				want := regular + max(spice.MinExtra, (recipe.Servings*spice.Percent+99)/100)
				if job.GetInt("bonus_servings") != want {
					t.Fatalf("servings: %d extra servings, want %d", job.GetInt("bonus_servings"), want)
				}
			case gamerules.SpiceRush:
				shift := left * time.Duration(spice.Percent) / 100
				if got := job.GetTime("ready_at"); !got.Equal(ready.Add(-shift)) || !job.GetTime("spoils_at").Equal(spoils.Add(-shift)) {
					t.Fatalf("rush: ready %v → %v", ready, got)
				}
			case gamerules.SpiceInstant:
				if status, _ := JobState(job, at); status != "ready" || !job.GetTime("spoils_at").Equal(spoils.Add(-left)) {
					t.Fatalf("instant: %s, spoils %v", status, job.GetTime("spoils_at"))
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

func TestSalviaRescuesASpoiledDish(t *testing.T) {
	s, stove := newCafe(t, "owner")
	salvia, _ := gamerules.SpiceByCode(800003)
	if salvia.Effect != gamerules.SpiceRescue {
		t.Fatalf("800003 is %q", salvia.Effect)
	}
	if err := StartCooking(s, "owner", stove, "pao_de_queijo", progressT0); err != nil {
		t.Fatal(err)
	}
	state, _ := GetOrCreatePlayer(s, "owner")
	addSpices(state, salvia.Code, 1)
	_ = s.Save(state)
	// Not while it cooks, neither as a seasoning nor as a rescue.
	if err := SeasonCooking(s, "owner", "owner", stove, salvia.Code, progressT0.Add(time.Second)); !errors.Is(err, ErrSpiceRescue) {
		t.Fatalf("salvia as a seasoning: %v", err)
	}
	if err := RescueCooking(s, "owner", stove, salvia.Code, progressT0.Add(time.Second)); !errors.Is(err, ErrNotRescuable) {
		t.Fatalf("rescuing a dish on the fire: %v", err)
	}
	job, _ := s.First("stove_cooking", Where{"stove": stove})
	_, spoils := JobState(job, progressT0)
	late := spoils.Add(time.Minute)
	if err := RescueCooking(s, "owner", stove, 800002, late); !errors.Is(err, ErrNotRescuable) {
		t.Fatalf("rescuing with another spice: %v", err)
	}
	if err := RescueCooking(s, "owner", stove, salvia.Code, late); err != nil {
		t.Fatal(err)
	}
	job, _ = s.First("stove_cooking", Where{"stove": stove})
	recipe, _ := gamerules.RecipeByID("pao_de_queijo")
	if status, until := JobState(job, late); status != "ready" || !until.Equal(late.Add(recipe.SpoilDuration())) {
		t.Fatalf("after the rescue: %s until %v", status, until)
	}
	if pantryOf(t, s, "owner")[salvia.Code] != 0 {
		t.Fatal("the salvia was not used up")
	}
	if err := RescueCooking(s, "owner", stove, salvia.Code, late); !errors.Is(err, ErrNotRescuable) {
		t.Fatalf("a ready dish needs no rescue: %v", err)
	}
	if err := ServeCooking(s, "owner", stove, late.Add(time.Second)); err != nil {
		t.Fatalf("serving the rescued dish: %v", err)
	}
}

func TestEnergyAcceleratesTheBatch(t *testing.T) {
	s, stove := newCafe(t, "owner")
	recipe, _ := gamerules.RecipeByID("coxinha")
	setPlayer(t, s, "owner", map[string]any{"gold": 1000, "level": recipe.Level, "experience_current": gamerules.Public().Levels[recipe.Level-1].RequiredXP})
	if err := BoostCooking(s, "owner", stove, progressT0); !errors.Is(err, ErrBoostClosed) {
		t.Fatalf("no batch: %v", err)
	}
	if err := StartCooking(s, "owner", stove, recipe.ID, progressT0); err != nil {
		t.Fatal(err)
	}
	rules := gamerules.Stove()
	at := progressT0.Add(gamerules.PrepareDuration())
	job, _ := s.First("stove_cooking", Where{"stove": stove})
	ready := job.GetTime("ready_at")
	left := ready.Sub(at)
	saved := left * time.Duration(rules.BoostPercent) / 100
	per := time.Duration(rules.BoostSecondsPerEnergy) * time.Second
	want := max(1, int((saved+per-1)/per))
	if cost, got := BoostCost(job, at); cost != want || got != saved {
		t.Fatalf("boost cost %d saving %v, want %d and %v", cost, got, want, saved)
	}
	before, _ := GetOrCreatePlayer(s, "owner")
	energy, _ := energyNow(before, at)
	if err := BoostCooking(s, "owner", stove, at); err != nil {
		t.Fatal(err)
	}
	job, _ = s.First("stove_cooking", Where{"stove": stove})
	if !job.GetTime("ready_at").Equal(ready.Add(-saved)) {
		t.Fatalf("ready %v, want %v", job.GetTime("ready_at"), ready.Add(-saved))
	}
	after, _ := GetOrCreatePlayer(s, "owner")
	if got, _ := energyNow(after, at); got != energy-want {
		t.Fatalf("energy %d → %d, want −%d", energy, got, want)
	}
	// Without energy nothing changes.
	setPlayer(t, s, "owner", map[string]any{"energy_current": 0, "energy_at": at})
	if err := BoostCooking(s, "owner", stove, at); !errors.Is(err, ErrEnergy) {
		t.Fatalf("boost without energy: %v", err)
	}
	unchanged, _ := s.First("stove_cooking", Where{"stove": stove})
	if !unchanged.GetTime("ready_at").Equal(job.GetTime("ready_at")) {
		t.Fatal("a refused boost moved the batch")
	}
	// A ready dish cannot be accelerated.
	if err := BoostCooking(s, "owner", stove, job.GetTime("ready_at")); !errors.Is(err, ErrBoostClosed) {
		t.Fatalf("boosting a ready dish: %v", err)
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
	// Draw the free crate's first spice prize: the roll lands after the weights before it.
	roll, spicePrize := 0, gamerules.CratePrize{}
	for _, prize := range surprise.Prizes {
		if prize.Spice > 0 {
			spicePrize = prize
			break
		}
		roll += prize.Weight
	}
	fixedDraws(t, roll)
	result, err := OpenCrate(s, "owner", "surprise", "request-free-000001", progressT0)
	if err != nil || result.Prize.Spice != spicePrize.Spice || result.State.Crates.Current != 3 {
		t.Fatalf("free crate: %+v %v", result, err)
	}
	if pantryOf(t, s, "owner")[spicePrize.Spice] != 1 {
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
	itemRoll, itemPrize := 0, gamerules.CratePrize{}
	for _, prize := range purple.Prizes {
		if prize.Item > 0 {
			itemPrize = prize
			break
		}
		itemRoll += prize.Weight
	}
	fixedDraws(t, itemRoll)
	item, err := OpenCrate(s, "owner", "purple", "request-purple-0002", progressT0)
	if err != nil || item.Prize.Item != itemPrize.Item || item.Prize.UnitID == "" || item.State.Cash != 0 {
		t.Fatalf("item crate: %+v %v", item, err)
	}
	unit, err := s.Get("player_inventory", item.Prize.UnitID)
	if err != nil || unit.GetBool("placed") || unit.GetInt("item_id") != itemPrize.Item || unit.GetString("user") != "owner" {
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

func TestCancellingInPreparationGivesTheSpiceBack(t *testing.T) {
	for _, tc := range []struct {
		name   string
		cancel time.Duration
		back   int
	}{{"preparing", time.Second / 2, 1}, {"cooking", gamerules.PrepareDuration() + time.Second, 0}} {
		t.Run(tc.name, func(t *testing.T) {
			s, stove := newCafe(t, "owner")
			if err := StartCooking(s, "owner", stove, "pao_de_queijo", progressT0); err != nil {
				t.Fatal(err)
			}
			state, _ := GetOrCreatePlayer(s, "owner")
			addSpices(state, 800002, 1)
			if err := s.Save(state); err != nil {
				t.Fatal(err)
			}
			if err := SeasonCooking(s, "owner", "owner", stove, 800002, progressT0.Add(time.Second/4)); err != nil {
				t.Fatal(err)
			}
			if _, err := CancelCooking(s, "owner", stove, progressT0.Add(tc.cancel)); err != nil {
				t.Fatal(err)
			}
			if got := pantryOf(t, s, "owner")[800002]; got != tc.back {
				t.Fatalf("spice back = %d, want %d", got, tc.back)
			}
		})
	}
}

func TestABadPantryEntryDoesNotEmptyThePantry(t *testing.T) {
	s, _ := newCafe(t, "owner")
	state, _ := GetOrCreatePlayer(s, "owner")
	state.Set("pantry", map[string]any{"800001": 2, "800002": "x", "800003": 1.5, "oops": 4})
	if err := s.Save(state); err != nil {
		t.Fatal(err)
	}
	spice, _ := gamerules.SpiceByCode(800001)
	setPlayer(t, s, "owner", map[string]any{"gold": spice.PriceCoins})
	if _, err := BuySpice(s, "owner", spice.Code, progressT0); err != nil {
		t.Fatal(err)
	}
	if got := pantryOf(t, s, "owner"); got[800001] != 3 || got[800003] != 1 || len(got) != 2 {
		t.Fatalf("pantry after a write = %v", got)
	}
}

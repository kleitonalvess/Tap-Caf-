package cafe

import (
	"errors"
	"testing"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
)

// serveFood puts a dish of the recipe on the counter and serves n portions.
func serveFood(t *testing.T, s Store, owner, recipeID string, servings, n int, at time.Time) []int64 {
	t.Helper()
	food, err := s.New("room_food")
	if err != nil {
		t.Fatal(err)
	}
	setAll(food, map[string]any{"user": owner, "recipe_id": recipeID, "job_id": "j", "servings": servings, "counter": "c"})
	if err := s.Save(food); err != nil {
		t.Fatal(err)
	}
	jars := []int64{}
	for range n {
		payment, err := ServeCustomer(s, owner, food.ID(), "", false, at)
		if err != nil {
			t.Fatal(err)
		}
		jars = append(jars, payment.TipJar)
	}
	return jars
}

func TestTheTipJarFillsUpToTheLevelBandAndIsCollected(t *testing.T) {
	s, _ := newCafe(t, "owner")
	if _, err := CollectTips(s, "owner", progressT0); !errors.Is(err, ErrTipJarEmpty) {
		t.Fatalf("collecting an empty jar: %v", err)
	}
	recipe, _ := gamerules.RecipeByID("moqueca")
	deposit := gamerules.TipJarDeposit(recipe.PricePerServing)
	limit := gamerules.TipJarCap(1)
	if limit != 100 || gamerules.TipJarCap(6) != 200 || gamerules.TipJarCap(21) != 500 || gamerules.TipJarCap(260) != 500 {
		t.Fatalf("the <tips> bands: %d %d %d %d", limit, gamerules.TipJarCap(6), gamerules.TipJarCap(21), gamerules.TipJarCap(260))
	}
	n := int(limit/deposit) + 3
	jars := serveFood(t, s, "owner", recipe.ID, n+1, n, progressT0)
	if jars[0] != deposit || jars[len(jars)-1] != limit {
		t.Fatalf("jar after each serving: %v (deposit %d, limit %d)", jars, deposit, limit)
	}
	room, _ := SnapshotRoom(s, "owner")
	if room.TipJar == nil || room.TipJar.Coins != limit || room.TipJar.Cap != limit {
		t.Fatalf("snapshot jar = %+v", room.TipJar)
	}
	before, _ := GetOrCreatePlayer(s, "owner")
	collected, err := CollectTips(s, "owner", progressT0)
	if err != nil || collected.Coins != limit || collected.Jar.Coins != 0 || collected.State.Gold != before.GetInt64("gold")+limit {
		t.Fatalf("collect: %+v %v", collected, err)
	}
	if cash := progressOf(t, s, "owner", progressT0); cash.Today[gamerules.StatTips] < limit {
		t.Fatalf("the jar's coins count as today's tips: %+v", cash.Today)
	}
}

func TestTheSixthDayClosesTheWeekWithAFreeCrate(t *testing.T) {
	if gamerules.DailyRewardFor(6).Crates != 1 {
		t.Fatal("day 6 should give a crate")
	}
	s, _ := newCafe(t, "owner")
	state, _ := GetOrCreatePlayer(s, "owner")
	state.Set("daily_claimed_on", bonusDate(progressT0.Add(-24*time.Hour)))
	state.Set("daily_streak", 5)
	crates := state.GetInt("crates_current")
	_ = s.Save(state)
	fixedDraws(t, 0)
	claim, err := ClaimDaily(s, "owner", progressT0)
	if err != nil || claim.Reward.Day != 6 || claim.Crates != 1 || claim.State.Crates.Current != float64(crates+1) {
		t.Fatalf("day 6: %+v %v", claim, err)
	}
	// At the crate limit the day still pays, without the crate.
	state, _ = GetOrCreatePlayer(s, "owner")
	state.Set("daily_claimed_on", bonusDate(progressT0))
	state.Set("daily_streak", 5)
	state.Set("crates_current", gamerules.CrateRulesNow().FreeMax)
	_ = s.Save(state)
	claim, err = ClaimDaily(s, "owner", progressT0.Add(24*time.Hour))
	if err != nil || claim.Crates != 0 || claim.State.Crates.Current != float64(gamerules.CrateRulesNow().FreeMax) {
		t.Fatalf("day 6 at the limit: %+v %v", claim, err)
	}
}

func TestTheCriticPaysMoreLiftsPopularityAndFillsTheJar(t *testing.T) {
	s, _ := newCafe(t, "owner")
	critic, ok := gamerules.VisitorByID("critic_initial")
	if !ok || !critic.Critic || critic.CoinsMultiplier != 3.5 {
		t.Fatalf("critic rules: %+v", critic)
	}
	recipe, _ := gamerules.RecipeByID("coxinha")
	food, _ := s.New("room_food")
	setAll(food, map[string]any{"user": "owner", "recipe_id": recipe.ID, "job_id": "j", "servings": 3, "counter": "c"})
	_ = s.Save(food)
	regular, err := ServeCustomer(s, "owner", food.ID(), "", false, progressT0)
	if err != nil {
		t.Fatal(err)
	}
	vip, err := ServeCustomerAs(s, "owner", food.ID(), "", gamewire.ServeOptions{VIP: critic.ID}, progressT0)
	if err != nil {
		t.Fatal(err)
	}
	wantCoins, wantXP := critic.VisitorPay(recipe.PricePerServing, recipe.XPPerServing)
	if vip.VIP != critic.ID || vip.Coins != wantCoins || vip.XP != wantXP || wantCoins <= regular.Coins {
		t.Fatalf("critic paid %d coins and %d XP (want %d and %d); a regular customer %d", vip.Coins, vip.XP, wantCoins, wantXP, regular.Coins)
	}
	lift := vip.PopularityTenths - regular.PopularityTenths
	if lift != critic.PopularityTenths+gamerules.ApplyCustomer(regular.PopularityTenths, true)-regular.PopularityTenths {
		t.Fatalf("popularity %d → %d (critic +%d)", regular.PopularityTenths, vip.PopularityTenths, critic.PopularityTenths)
	}
	deposit := gamerules.TipJarDeposit(recipe.PricePerServing)
	if vip.TipJar != regular.TipJar+deposit+critic.TipJarCoins {
		t.Fatalf("tip jar %d → %d", regular.TipJar, vip.TipJar)
	}
	if stats, err := s.First(StatsCollection, Where{"user": "owner"}); err != nil || readStats(stats).counts[gamerules.StatVisitors] != 1 {
		t.Fatalf("visitors served: %v", err)
	}
	// An unknown visitor id pays as a regular customer.
	plain, err := ServeCustomerAs(s, "owner", food.ID(), "", gamewire.ServeOptions{VIP: "nobody"}, progressT0)
	if err != nil || plain.VIP != "" || plain.Coins != regular.Coins {
		t.Fatalf("unknown visitor: %+v %v", plain, err)
	}
}

package gamerules

import (
	"testing"
	"time"
)

func TestLevelForXPBoundaries(t *testing.T) {
	cases := []struct {
		xp    int64
		level int
	}{
		{0, 1}, {6, 1}, {7, 2}, {39, 2}, {40, 3}, {7353539, 259}, {7353540, 260}, {1 << 40, 260},
	}
	for _, c := range cases {
		if got := LevelForXP(c.xp); got != c.level {
			t.Errorf("LevelForXP(%d) = %d, want %d", c.xp, got, c.level)
		}
	}
}

func TestNextLevelXPAndRewards(t *testing.T) {
	if got := NextLevelXP(1); got != 7 {
		t.Fatalf("NextLevelXP(1) = %d, want 7", got)
	}
	if got := NextLevelXP(MaxLevel()); got != 7353540 {
		t.Fatalf("NextLevelXP(max) = %d, want the cap requirement", got)
	}
	// Levels 2 and 3 grant 700 coins each in the reference configuration.
	if got := LevelRewards(1, 3); got != 1400 {
		t.Fatalf("LevelRewards(1, 3) = %d, want 1400", got)
	}
	if got := LevelRewards(3, 3); got != 0 {
		t.Fatalf("LevelRewards without a new level = %d, want 0", got)
	}
}

func TestPopularityIsClamped(t *testing.T) {
	low, high := PopularityBoundsTenths()
	if low != 50 || high != 1050 {
		t.Fatalf("bounds = %d..%d, want 50..1050", low, high)
	}
	if got := ApplyCustomer(800, true); got != 801 {
		t.Fatalf("satisfied customer = %d, want 801", got)
	}
	if got := ApplyCustomer(800, false); got != 797 {
		t.Fatalf("unsatisfied customer = %d, want 797", got)
	}
	if got := ApplyCustomer(high, true); got != high {
		t.Fatalf("popularity exceeded its maximum: %d", got)
	}
	if got := ApplyCustomer(low+1, false); got != low {
		t.Fatalf("popularity fell below its minimum: %d", got)
	}
}

func TestCustomersPerMinuteFollowsBands(t *testing.T) {
	cases := map[int]int{0: 5, 50: 5, 149: 5, 150: 7, 800: 19, 1050: 25}
	for tenths, want := range cases {
		if got := CustomersPerMinute(tenths); got != want {
			t.Errorf("CustomersPerMinute(%d) = %d, want %d", tenths, got, want)
		}
	}
}

func TestEmbeddedRecipes(t *testing.T) {
	cake, ok := RecipeByID("cake_1")
	if !ok || cake.Servings < 1 || cake.CookDuration() <= 0 {
		t.Fatalf("starter recipe unavailable: %+v", cake)
	}
	if _, ok := RecipeByID("missing"); ok {
		t.Fatal("unknown recipe was accepted")
	}
}

func TestValidateRejectsBrokenData(t *testing.T) {
	broken := rules
	broken.Levels = append([]Level{}, rules.Levels...)
	broken.Levels[2].RequiredXP = broken.Levels[1].RequiredXP
	if validate(broken) == "" {
		t.Fatal("non-increasing XP was accepted")
	}
	broken = rules
	broken.Recipes = append([]Recipe{}, rules.Recipes...)
	broken.Recipes[0].ID = "Bolo Inválido"
	if validate(broken) == "" {
		t.Fatal("invalid recipe id was accepted")
	}
}

func TestCheapestRecipeRespectsLevel(t *testing.T) {
	cheapest, ok := CheapestRecipe(1)
	if !ok || cheapest.Level > 1 {
		t.Fatalf("cheapest at level 1 = %+v", cheapest)
	}
	for _, recipe := range Recipes() {
		if recipe.Level <= 1 && recipe.CostCoins < cheapest.CostCoins {
			t.Fatalf("%s is cheaper than %s", recipe.ID, cheapest.ID)
		}
	}
	if _, ok := CheapestRecipe(0); ok {
		t.Fatal("a recipe was unlocked below level 1")
	}
}

func TestRecipeBookIsProgressive(t *testing.T) {
	recipes := Recipes()
	if len(recipes) < 6 {
		t.Fatalf("recipe book has %d recipes", len(recipes))
	}
	for i := 1; i < len(recipes); i++ {
		if recipes[i].Level < recipes[i-1].Level {
			t.Fatalf("%s unlocks before %s", recipes[i].ID, recipes[i-1].ID)
		}
	}
	for _, recipe := range recipes {
		if recipe.SpoilDuration() < 30*time.Second {
			t.Fatalf("%s spoils too fast", recipe.ID)
		}
	}
}

func TestSeasonBonusRoundsUp(t *testing.T) {
	// 25% in the reference rules.
	for servings, want := range map[int]int{1: 1, 3: 1, 4: 1, 5: 2, 40: 10} {
		if got := SeasonBonus(servings); got != want {
			t.Errorf("SeasonBonus(%d) = %d, want %d", servings, got, want)
		}
	}
}

func TestCustomerPatienceCoversTheStarterRecipe(t *testing.T) {
	cheapest, _ := CheapestRecipe(1)
	if CustomerPatience() <= cheapest.CookDuration()+PrepareDuration() {
		t.Fatalf("patience %v cannot wait for %s (%v)", CustomerPatience(), cheapest.ID, cheapest.CookDuration())
	}
	if CookingArrivalFactor() < 1 {
		t.Fatal("cooking must not speed up arrivals")
	}
}

func TestPublicRulesAreACopy(t *testing.T) {
	public := Public()
	public.Recipes[0].CostCoins = 999999
	if rules.Recipes[0].CostCoins == 999999 {
		t.Fatal("Public exposes the shared recipe slice")
	}
}

func TestTableRulesAreValid(t *testing.T) {
	if TableCleaning() <= 0 || Tables().CleaningXP < 0 {
		t.Fatalf("table rules = %+v", Tables())
	}
	if Public().Tables != Tables() {
		t.Fatal("table rules missing from the public rules")
	}
}

func TestEmployeeSlotsFollowTheConfigLocks(t *testing.T) {
	cases := map[int]int{1: 1, 6: 1, 7: 2, 14: 2, 15: 3, 46: 6, 47: 7, 260: 7}
	for level, want := range cases {
		if got := EmployeeSlots(level); got != want {
			t.Fatalf("level %d: %d slots, want %d", level, got, want)
		}
	}
	if next, ok := NextEmployeeSlotLevel(1); !ok || next != 7 {
		t.Fatalf("next slot after level 1 = %d %v", next, ok)
	}
	if _, ok := NextEmployeeSlotLevel(47); ok {
		t.Fatal("no slot after level 47")
	}
}

func TestStaffProfilesIncludeTheVostuWaiter(t *testing.T) {
	vostu, ok := StaffProfileByID("vostu")
	if !ok || vostu.Role != RoleWaiter {
		t.Fatalf("vostu = %+v %v", vostu, ok)
	}
	if len(Public().Staff.Profiles) < EmployeeSlots(MaxLevel()) {
		t.Fatal("fewer profiles than slots")
	}
}

// Package gamerules holds the data-driven game rules shared by persistence and
// the room service. Values are loaded from rules.json and validated at startup;
// gameplay code asks these functions instead of hardcoding numbers.
package gamerules

import (
	"embed"
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"time"
)

//go:embed rules.json
var files embed.FS

type Level struct {
	Level       int   `json:"level"`
	RequiredXP  int64 `json:"requiredXp"`
	RewardCoins int64 `json:"rewardCoins"`
}

// Recipe values are per cooked batch, except the per-serving payment fields.
type Recipe struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Level           int    `json:"level"`
	CostCoins       int64  `json:"costCoins"`
	CookSeconds     int    `json:"cookSeconds"`
	Servings        int    `json:"servings"`
	PricePerServing int64  `json:"pricePerServing"`
	XPPerServing    int64  `json:"xpPerServing"`
	// A ready dish spoils on the stove after this long without being served.
	SpoilSeconds int `json:"spoilSeconds"`
	// Provisional marks design placeholders, not values recovered from the original game.
	Provisional bool `json:"provisional,omitempty"`
}

// StoveRules cover the parts of the stove cycle shared by every recipe.
type StoveRules struct {
	PrepareSeconds int   `json:"prepareSeconds"`
	CleaningCoins  int64 `json:"cleaningCoins"`
	CleaningXP     int64 `json:"cleaningXp"`
	// Seasoning during preparation adds this share of the recipe's servings (rounded up).
	SeasonBonusPercent int   `json:"seasonBonusPercent"`
	SeasonXP           int64 `json:"seasonXp"`
}

type CustomerRules struct {
	// How long a seated customer waits for food before leaving unsatisfied.
	PatienceSeconds int `json:"patienceSeconds"`
	// Arrivals slow down by this factor while food is cooking and no counter has any.
	CookingArrivalFactor float64 `json:"cookingArrivalFactor"`
}

// Frequency applies from Popularity upward. The reference file does not state
// its unit; the room service interprets it as customers per minute.
type Frequency struct {
	Popularity int `json:"popularity"`
	PerMinute  int `json:"perMinute"`
}

type Tip struct {
	Level int   `json:"level"`
	Coins int64 `json:"coins"`
}

type EmployeeLock struct {
	Employees int `json:"employees"`
	Level     int `json:"level"`
}

// PopularityRules use whole popularity points; storage keeps tenths.
type PopularityRules struct {
	Min              int     `json:"min"`
	Max              int     `json:"max"`
	SatisfiedDelta   float64 `json:"satisfiedDelta"`
	UnsatisfiedDelta float64 `json:"unsatisfiedDelta"`
}

type Rules struct {
	Popularity        PopularityRules `json:"popularity"`
	Customers         CustomerRules   `json:"customers"`
	Stove             StoveRules      `json:"stove"`
	Levels            []Level         `json:"levels"`
	CustomerFrequency []Frequency     `json:"customerFrequency"`
	Tips              []Tip           `json:"tips"`
	EmployeeLocks     []EmployeeLock  `json:"employeeLocks"`
	Recipes           []Recipe        `json:"recipes"`
}

// Recipe ids are stored in stove_cooking.recipe_id and room_food.recipe_id (max 40).
var recipeIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)

var rules Rules

func init() {
	data, err := files.ReadFile("rules.json")
	if err != nil {
		panic(err)
	}
	var parsed Rules
	if err := json.Unmarshal(data, &parsed); err != nil {
		panic(err)
	}
	if message := validate(parsed); message != "" {
		panic("invalid game rules: " + message)
	}
	rules = parsed
}

func validate(r Rules) string {
	if len(r.Levels) == 0 || r.Levels[0].Level != 1 || r.Levels[0].RequiredXP != 0 {
		return "levels must start at level 1 with 0 XP"
	}
	for i, level := range r.Levels {
		if level.Level != i+1 || level.RewardCoins < 0 || i > 0 && level.RequiredXP <= r.Levels[i-1].RequiredXP {
			return "levels must be contiguous with increasing XP"
		}
	}
	p := r.Popularity
	if p.Min < 0 || p.Max <= p.Min || p.SatisfiedDelta <= 0 || p.UnsatisfiedDelta <= 0 {
		return "invalid popularity bounds"
	}
	if len(r.CustomerFrequency) == 0 {
		return "missing customer frequency"
	}
	for i, f := range r.CustomerFrequency {
		if f.PerMinute <= 0 || i > 0 && f.Popularity <= r.CustomerFrequency[i-1].Popularity {
			return "customer frequency must increase by popularity"
		}
	}
	for i, t := range r.Tips {
		if t.Coins < 0 || i > 0 && t.Level <= r.Tips[i-1].Level {
			return "tips must increase by level"
		}
	}
	for i, lock := range r.EmployeeLocks {
		if lock.Employees != i+1 || lock.Level < 1 || i > 0 && lock.Level < r.EmployeeLocks[i-1].Level {
			return "employee locks must be contiguous"
		}
	}
	c := r.Customers
	if c.PatienceSeconds < 5 || c.PatienceSeconds > 600 || c.CookingArrivalFactor < 1 || c.CookingArrivalFactor > 5 {
		return "invalid customer rules"
	}
	s := r.Stove
	if s.PrepareSeconds < 0 || s.PrepareSeconds > 60 || s.CleaningCoins < 0 || s.CleaningXP < 0 ||
		s.SeasonBonusPercent < 0 || s.SeasonBonusPercent > 100 || s.SeasonXP < 0 {
		return "invalid stove rules"
	}
	const week = 7 * 24 * 60 * 60
	seen := map[string]bool{}
	for _, recipe := range r.Recipes {
		if !recipeIDPattern.MatchString(recipe.ID) || seen[recipe.ID] || recipe.Name == "" ||
			recipe.Level < 1 || recipe.Level > len(r.Levels) || recipe.CostCoins < 0 ||
			recipe.CookSeconds < 1 || recipe.CookSeconds > week || recipe.Servings < 1 || recipe.Servings > 100 ||
			recipe.PricePerServing < 0 || recipe.XPPerServing < 0 || recipe.SpoilSeconds < 30 || recipe.SpoilSeconds > week {
			return "invalid recipe " + recipe.ID
		}
		seen[recipe.ID] = true
	}
	if len(seen) == 0 {
		return "missing recipes"
	}
	return ""
}

func RecipeByID(id string) (Recipe, bool) {
	for _, recipe := range rules.Recipes {
		if recipe.ID == id {
			return recipe, true
		}
	}
	return Recipe{}, false
}

func (r Recipe) CookDuration() time.Duration {
	return time.Duration(r.CookSeconds) * time.Second
}

func (r Recipe) SpoilDuration() time.Duration {
	return time.Duration(r.SpoilSeconds) * time.Second
}

// Recipes returns the catalogue in book order.
func Recipes() []Recipe { return append([]Recipe{}, rules.Recipes...) }

// CheapestRecipe is the recipe the emergency help gives away: the lowest cost
// unlocked at this level, then the shortest, then the id for a stable answer.
func CheapestRecipe(level int) (Recipe, bool) {
	unlocked := []Recipe{}
	for _, recipe := range rules.Recipes {
		if recipe.Level <= level {
			unlocked = append(unlocked, recipe)
		}
	}
	if len(unlocked) == 0 {
		return Recipe{}, false
	}
	sort.SliceStable(unlocked, func(i, j int) bool {
		a, b := unlocked[i], unlocked[j]
		if a.CostCoins != b.CostCoins {
			return a.CostCoins < b.CostCoins
		}
		if a.CookSeconds != b.CookSeconds {
			return a.CookSeconds < b.CookSeconds
		}
		return a.ID < b.ID
	})
	return unlocked[0], true
}

func Stove() StoveRules { return rules.Stove }

func PrepareDuration() time.Duration { return time.Duration(rules.Stove.PrepareSeconds) * time.Second }

// SeasonBonus is the extra servings a seasoned batch yields; at least one when enabled.
func SeasonBonus(servings int) int {
	if rules.Stove.SeasonBonusPercent == 0 {
		return 0
	}
	return max(1, (servings*rules.Stove.SeasonBonusPercent+99)/100)
}

func CustomerPatience() time.Duration {
	return time.Duration(rules.Customers.PatienceSeconds) * time.Second
}

func CookingArrivalFactor() float64 { return rules.Customers.CookingArrivalFactor }

// Public is the whole rule set for clients; none of it is secret.
func Public() Rules {
	snapshot := rules
	snapshot.Levels = append([]Level{}, rules.Levels...)
	snapshot.Recipes = Recipes()
	return snapshot
}

func MaxLevel() int { return len(rules.Levels) }

// LevelForXP returns the highest level whose requirement is met by total XP.
func LevelForXP(xp int64) int {
	level := 1
	for _, l := range rules.Levels {
		if xp < l.RequiredXP {
			break
		}
		level = l.Level
	}
	return level
}

// NextLevelXP is the total XP that reaches level+1; the last level returns its own requirement.
func NextLevelXP(level int) int64 {
	if level < 1 {
		level = 1
	}
	if level >= len(rules.Levels) {
		return rules.Levels[len(rules.Levels)-1].RequiredXP
	}
	return rules.Levels[level].RequiredXP
}

// LevelRewards sums the coins granted for every level after from, up to and including to.
func LevelRewards(from, to int) int64 {
	var total int64
	for _, l := range rules.Levels {
		if l.Level > from && l.Level <= to {
			total += l.RewardCoins
		}
	}
	return total
}

// PopularityBoundsTenths matches player_state.satisfaction_*_tenths.
func PopularityBoundsTenths() (int, int) {
	return rules.Popularity.Min * 10, rules.Popularity.Max * 10
}

// ApplyCustomer returns the popularity, in tenths, after one customer's verdict.
func ApplyCustomer(tenths int, satisfied bool) int {
	low, high := PopularityBoundsTenths()
	if satisfied {
		tenths += int(math.Round(rules.Popularity.SatisfiedDelta * 10))
	} else {
		tenths -= int(math.Round(rules.Popularity.UnsatisfiedDelta * 10))
	}
	return min(high, max(low, tenths))
}

// CustomersPerMinute uses the highest frequency band reached by the popularity.
func CustomersPerMinute(tenths int) int {
	perMinute := rules.CustomerFrequency[0].PerMinute
	for _, f := range rules.CustomerFrequency {
		if tenths < f.Popularity*10 {
			break
		}
		perMinute = f.PerMinute
	}
	return perMinute
}

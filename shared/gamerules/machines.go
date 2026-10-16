package gamerules

import (
	"slices"
	"time"

	"coffe-mania/shared/roomcatalog"
)

// EnergyRules: energy refills by one point every RegenSeconds up to Max,
// derived from a stored instant (never a tick). Drinks may push it above Max,
// never above Cap; regeneration waits while it is at or above Max.
type EnergyRules struct {
	Provisional  bool `json:"provisional,omitempty"`
	Max          int  `json:"max"`
	RegenSeconds int  `json:"regenSeconds"`
	Cap          int  `json:"cap"`
}

// Consumable is a pantry item that is not a spice: an energy drink or a
// machine part. Exactly one of the prices is set.
type Consumable struct {
	Code        int    `json:"code"`
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	Amount      int    `json:"amount"`
	PriceCoins  int64  `json:"priceCoins,omitempty"`
	PriceCash   int64  `json:"priceCash,omitempty"`
	Description string `json:"description"`
}

const (
	ConsumableEnergy = "energy"
	ConsumablePart   = "part"
)

// StockReward is a number of one consumable.
type StockReward struct {
	Code  int `json:"code"`
	Count int `json:"count"`
}

// PantryRules: how many charges of each spice the pantry holds, more with a
// spice shelf placed, which also gives a chance of a free spice per harvest.
type PantryRules struct {
	Provisional         bool `json:"provisional,omitempty"`
	SpiceLimit          int  `json:"spiceLimit"`
	ShelfSpiceLimit     int  `json:"shelfSpiceLimit"`
	ShelfHarvestPercent int  `json:"shelfHarvestPercent"`
}

// EntertainmentRules: a jukebox or an arcade is bought as a frame and built
// with machine parts (level 1), then upgraded with parts and coins. Switched
// on with energy it runs RunSeconds, lifting customers' patience, and pays its
// level's coins and XP when collected; every MaintenanceRuns runs it breaks
// and needs a repair (energy).
type EntertainmentRules struct {
	Provisional     bool                   `json:"provisional,omitempty"`
	RunSeconds      int                    `json:"runSeconds"`
	MaintenanceRuns int                    `json:"maintenanceRuns"`
	StartEnergy     int                    `json:"startEnergy"`
	RepairEnergy    int                    `json:"repairEnergy"`
	Machines        []EntertainmentMachine `json:"machines"`
}

type EntertainmentMachine struct {
	Item   int                  `json:"item"`
	Levels []EntertainmentLevel `json:"levels"`
}

// EntertainmentLevel: the parts and coins that build this level, and what a
// run pays and lifts at it.
type EntertainmentLevel struct {
	Parts           int   `json:"parts"`
	Coins           int64 `json:"coins"`
	RunCoins        int64 `json:"runCoins"`
	RunXP           int64 `json:"runXp"`
	PatiencePercent int   `json:"patiencePercent"`
}

func consumableIn(r Rules, code int) (Consumable, bool) {
	for _, c := range r.Consumables {
		if c.Code == code {
			return c, true
		}
	}
	return Consumable{}, false
}

func validateMachines(r Rules) string {
	e := r.Energy
	if e.Max < 1 || e.Max > 1000 || e.RegenSeconds < 10 || e.RegenSeconds > 3600 || e.Cap < e.Max || e.Cap > 10000 {
		return "invalid energy rules"
	}
	codes := map[int]bool{}
	for _, spice := range r.Spices.List {
		codes[spice.Code] = true
	}
	for _, c := range r.Consumables {
		priced := (c.PriceCoins > 0) != (c.PriceCash > 0)
		if c.Code < 810000 || c.Code > 829999 || codes[c.Code] || c.Name == "" || c.Amount < 1 || c.Amount > 1000 || !priced ||
			c.PriceCoins < 0 || c.PriceCash < 0 || c.Kind != ConsumableEnergy && c.Kind != ConsumablePart {
			return "invalid consumable"
		}
		codes[c.Code] = true
	}
	for _, reward := range r.Missions.TrioStock {
		if _, ok := consumableIn(r, reward.Code); !ok || reward.Count < 1 || reward.Count > 10 {
			return "invalid mission trio stock"
		}
	}
	p := r.Pantry
	if p.SpiceLimit < 1 || p.ShelfSpiceLimit < p.SpiceLimit || p.ShelfSpiceLimit > 999 || p.ShelfHarvestPercent < 0 || p.ShelfHarvestPercent > 100 {
		return "invalid pantry limits"
	}
	seen := map[string]bool{}
	for _, recipe := range r.Recipes {
		seen[recipe.ID] = true
	}
	week := 7 * 24 * 3600
	for _, drink := range r.Drinks {
		if !recipeIDPattern.MatchString(drink.ID) || seen[drink.ID] || drink.Name == "" || drink.Level < 1 || drink.Level > len(r.Levels) ||
			drink.CostCoins < 0 || drink.CookSeconds < 1 || drink.CookSeconds > week || drink.Servings < 1 || drink.Servings > 100 ||
			drink.PricePerServing < 0 || drink.XPPerServing < 0 || drink.SpoilSeconds < 30 || drink.SpoilSeconds > week ||
			!slices.Contains(roomcatalog.Machines, drink.Machine) || drink.Energy < 0 || drink.Energy > e.Max {
			return "invalid drink " + drink.ID
		}
		seen[drink.ID] = true
	}
	for _, recipe := range r.Recipes {
		if recipe.Machine != "" || recipe.Energy != 0 {
			return "recipes cook on stoves: " + recipe.ID
		}
	}
	t := r.Entertainment
	if t.RunSeconds < 60 || t.RunSeconds > 86400 || t.MaintenanceRuns < 1 || t.MaintenanceRuns > 100 ||
		t.StartEnergy < 0 || t.StartEnergy > e.Max || t.RepairEnergy < 0 || t.RepairEnergy > e.Max {
		return "invalid entertainment rules"
	}
	items := map[int]bool{}
	for _, machine := range t.Machines {
		item, ok := roomcatalog.ByID(machine.Item)
		if !ok || item.Kind != "entertainment" || items[machine.Item] || len(machine.Levels) < 1 || len(machine.Levels) > 5 {
			return "invalid entertainment machine"
		}
		items[machine.Item] = true
		for i, level := range machine.Levels {
			if level.Parts < 1 || level.Parts > 50 || level.Coins < 0 || level.RunCoins < 0 || level.RunXP < 0 ||
				level.PatiencePercent < 0 || level.PatiencePercent > 100 || i > 0 && level.PatiencePercent < machine.Levels[i-1].PatiencePercent {
				return "invalid entertainment level"
			}
		}
	}
	for _, item := range roomcatalog.Items {
		if item.Kind == "entertainment" && !items[item.ID] {
			return "entertainment item without rules: " + item.Classname
		}
	}
	return ""
}

func Energy() EnergyRules { return rules.Energy }

// EnergyRegen is how long one point of energy takes to come back.
func EnergyRegen() time.Duration { return time.Duration(rules.Energy.RegenSeconds) * time.Second }

func Consumables() []Consumable { return append([]Consumable{}, rules.Consumables...) }

func ConsumableByCode(code int) (Consumable, bool) { return consumableIn(rules, code) }

func Pantry() PantryRules { return rules.Pantry }

func Drinks() []Recipe { return append([]Recipe{}, rules.Drinks...) }

// IsDrink reports whether the id is one of the machines' drinks.
func IsDrink(id string) bool {
	return slices.ContainsFunc(rules.Drinks, func(d Recipe) bool { return d.ID == id })
}

func EntertainmentRulesNow() EntertainmentRules {
	t := rules.Entertainment
	t.Machines = append([]EntertainmentMachine{}, t.Machines...)
	return t
}

func EntertainmentFor(itemID int) (EntertainmentMachine, bool) {
	for _, machine := range rules.Entertainment.Machines {
		if machine.Item == itemID {
			return machine, true
		}
	}
	return EntertainmentMachine{}, false
}

func EntertainmentRun() time.Duration {
	return time.Duration(rules.Entertainment.RunSeconds) * time.Second
}

func MissionTrioStock() []StockReward { return append([]StockReward{}, rules.Missions.TrioStock...) }

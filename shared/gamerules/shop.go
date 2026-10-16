package gamerules

import (
	"slices"

	"coffe-mania/shared/roomcatalog"
)

// SetRules: distinct items of one theme placed in the café pay a set bonus
// (the highest tier reached), outside the cap on the items' own charm.
type SetRules struct {
	Provisional bool       `json:"provisional,omitempty"`
	Themes      []SetTheme `json:"themes"`
	Tiers       []SetTier  `json:"tiers"`
}

type SetTheme struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type SetTier struct {
	Pieces int `json:"pieces"`
	Tenths int `json:"tenths"`
}

// DecorSet is one theme's progress: distinct pieces placed and the bonus paid.
type DecorSet struct {
	Theme  string `json:"theme"`
	Name   string `json:"name"`
	Pieces int    `json:"pieces"`
	// The next tier's piece count (0 when the last tier is reached).
	Next   int `json:"next"`
	Tenths int `json:"tenths"`
}

// EquipmentRules: how many stoves and counters may stand in the café, by
// expansion step (index 0 is the starter room), and what selling returns.
type EquipmentRules struct {
	Provisional bool  `json:"provisional,omitempty"`
	Stoves      []int `json:"stoves"`
	Counters    []int `json:"counters"`
	SellPercent int   `json:"sellPercent"`
}

func validateShop(r Rules) string {
	sets := r.Decor.Sets
	if len(sets.Themes) != len(roomcatalog.Themes) {
		return "decor sets must name every catalogue theme"
	}
	for _, theme := range sets.Themes {
		if !slices.Contains(roomcatalog.Themes, theme.ID) || theme.Name == "" {
			return "unknown decor set theme"
		}
	}
	for i, tier := range sets.Tiers {
		if tier.Pieces < 2 || tier.Tenths <= 0 || tier.Tenths > 200 || i > 0 && (tier.Pieces <= sets.Tiers[i-1].Pieces || tier.Tenths <= sets.Tiers[i-1].Tenths) {
			return "decor set tiers must grow"
		}
	}
	e := r.Equipment
	steps := len(r.Expansions.Steps) + 1
	for _, limits := range [][]int{e.Stoves, e.Counters} {
		if len(limits) != steps {
			return "equipment limits must cover every expansion step"
		}
		for i, limit := range limits {
			if limit < 1 || limit > 40 || i > 0 && limit < limits[i-1] {
				return "equipment limits must not shrink"
			}
		}
	}
	if e.SellPercent < 0 || e.SellPercent > 100 {
		return "invalid sell percent"
	}
	return ""
}

func decorSets(copies map[int]int) ([]DecorSet, int) {
	sets := []DecorSet{}
	total := 0
	for _, theme := range rules.Decor.Sets.Themes {
		pieces := 0
		for id := range copies {
			if item, ok := roomcatalog.ByID(id); ok && item.Theme == theme.ID {
				pieces++
			}
		}
		if pieces == 0 {
			continue
		}
		set := DecorSet{Theme: theme.ID, Name: theme.Name, Pieces: pieces}
		for _, tier := range rules.Decor.Sets.Tiers {
			if pieces >= tier.Pieces {
				set.Tenths = tier.Tenths
			} else if set.Next == 0 {
				set.Next = tier.Pieces
			}
		}
		total += set.Tenths
		sets = append(sets, set)
	}
	return sets, total
}

func maxSetTenths() int {
	tiers := rules.Decor.Sets.Tiers
	if len(tiers) == 0 {
		return 0
	}
	return tiers[len(tiers)-1].Tenths * len(rules.Decor.Sets.Themes)
}

// expansionStep is the café's expansion index: 0 for the starter room.
func expansionStep(tiles int) int {
	step := 0
	for _, s := range rules.Expansions.Steps {
		if tiles >= s.Tiles {
			step++
		}
	}
	return step
}

// EquipmentLimit is how many units of a working kind ("stove" or "counter")
// may stand in a café of this size; other kinds have no limit (0).
func EquipmentLimit(kind string, tiles int) int {
	step := expansionStep(tiles)
	switch kind {
	case "stove":
		return rules.Equipment.Stoves[min(step, len(rules.Equipment.Stoves)-1)]
	case "counter":
		return rules.Equipment.Counters[min(step, len(rules.Equipment.Counters)-1)]
	}
	return 0
}

// SellValue is what selling a stored unit returns, in coins: a share of its
// coin price. Grana items and items outside the store have no coin price.
func SellValue(item roomcatalog.Item) int64 {
	if !item.Purchasable || item.PaidWithCash() {
		return 0
	}
	return item.PriceGold * int64(rules.Equipment.SellPercent) / 100
}

func Equipment() EquipmentRules {
	e := rules.Equipment
	e.Stoves = append([]int{}, e.Stoves...)
	e.Counters = append([]int{}, e.Counters...)
	return e
}

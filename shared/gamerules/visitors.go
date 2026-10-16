package gamerules

import (
	"math"
	"time"
)

// VisitorRules: special customers (the restaurant critic and the parody
// celebrities). The config's <visitors> gives the critic_initial and rock_*
// stereotypes with coins ×3.5 and XP q + multiplier; names (parodies chosen by
// the project owner), chance, cooldown, popularity and tip-jar bonuses are design.
type VisitorRules struct {
	// MinLevel: the café's level from which visitors come.
	MinLevel int `json:"minLevel"`
	// ChancePercent of an arriving customer being a visitor, at most one inside
	// and one per CooldownSeconds.
	ChancePercent   int       `json:"chancePercent"`
	CooldownSeconds int       `json:"cooldownSeconds"`
	List            []Visitor `json:"list"`
	Provisional     bool      `json:"provisional,omitempty"`
}

type Visitor struct {
	ID string `json:"id"`
	// Code of the config's <visitor>, when it has one.
	Code  int    `json:"code,omitempty"`
	Name  string `json:"name"`
	Title string `json:"title"`
	// A critic writes the review; the others are celebrities.
	Critic bool `json:"critic,omitempty"`
	// The serving pays its price × CoinsMultiplier, and XP + XPBase + XP × XPMultiplier (rounded up).
	CoinsMultiplier float64 `json:"coinsMultiplier"`
	XPBase          int64   `json:"xpBase,omitempty"`
	XPMultiplier    float64 `json:"xpMultiplier,omitempty"`
	// Served in time: popularity on top of the regular verdict, and coins into the tip jar.
	PopularityTenths int    `json:"popularityTenths"`
	TipJarCoins      int64  `json:"tipJarCoins"`
	Review           string `json:"review"`
	MinLevel         int    `json:"minLevel,omitempty"`
}

// VisitorPay is what a visitor pays for a serving of this price and XP.
func (v Visitor) VisitorPay(price, xp int64) (int64, int64) {
	coins := int64(math.Ceil(float64(price) * v.CoinsMultiplier))
	return max(price, coins), xp + v.XPBase + int64(math.Ceil(float64(xp)*v.XPMultiplier))
}

func Visitors() VisitorRules { return rules.Visitors }

func VisitorByID(id string) (Visitor, bool) {
	for _, visitor := range rules.Visitors.List {
		if visitor.ID == id {
			return visitor, true
		}
	}
	return Visitor{}, false
}

// VisitorsFor are the visitors a café of this level may receive.
func VisitorsFor(level int) []Visitor {
	if level < rules.Visitors.MinLevel {
		return nil
	}
	list := []Visitor{}
	for _, visitor := range rules.Visitors.List {
		if level >= visitor.MinLevel {
			list = append(list, visitor)
		}
	}
	return list
}

func VisitorCooldown() time.Duration {
	return time.Duration(rules.Visitors.CooldownSeconds) * time.Second
}

func validateVisitors(r Rules) string {
	v := r.Visitors
	if v.MinLevel < 1 || v.ChancePercent < 0 || v.ChancePercent > 100 || v.CooldownSeconds < 0 || len(v.List) == 0 {
		return "invalid visitors"
	}
	seen := map[string]bool{}
	for _, visitor := range v.List {
		if !recipeIDPattern.MatchString(visitor.ID) || seen[visitor.ID] || visitor.Name == "" || visitor.Review == "" ||
			visitor.CoinsMultiplier < 1 || visitor.CoinsMultiplier > 10 || visitor.XPBase < 0 || visitor.XPMultiplier < 0 ||
			visitor.PopularityTenths < 0 || visitor.PopularityTenths > 100 || visitor.TipJarCoins < 0 {
			return "invalid visitor " + visitor.ID
		}
		seen[visitor.ID] = true
	}
	return ""
}

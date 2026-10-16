package gamerules

import "regexp"

// NeighborRules: the non-player neighbours of the bottom bar and the daily
// help. The config's <special_neighbors> has two (id -1, always; id -2, from
// level 69); "Papa dos Pudins" is the special neighbour of the original menu in
// the art director's Behance portfolio; the other names, cafés, levels and the
// help rewards are design.
type NeighborRules struct {
	// Each player may help each neighbour this many times a day (São Paulo date).
	HelpsPerDay int            `json:"helpsPerDay"`
	HelpReward  NeighborReward `json:"helpReward"`
	List        []Neighbor     `json:"list"`
	Provisional bool           `json:"provisional,omitempty"`
}

type NeighborReward struct {
	Coins  int64 `json:"coins"`
	XP     int64 `json:"xp"`
	Energy int   `json:"energy"`
}

type Neighbor struct {
	// ID is also the café's user id: 15 lowercase letters and digits, like a
	// PocketBase record id (the server creates a user for each).
	ID string `json:"id"`
	// Special: the config's <special_neighbors> id (-1, -2), 0 for the others.
	Special  int    `json:"special,omitempty"`
	Name     string `json:"name"`
	CafeName string `json:"cafeName"`
	Level    int    `json:"level"`
	// Theme of the café's decoration (japan, italy, noble) and the dish on its stove.
	Theme   string `json:"theme,omitempty"`
	Recipe  string `json:"recipe"`
	Tagline string `json:"tagline"`
	// The player's level from which this neighbour appears.
	MinLevel int `json:"minLevel,omitempty"`
}

// GiftRules: the config's <pushGift> (rewardCoins 250, rewardXp 3, dailyGifts
// 5, daysLimit 10): a player sends and claims up to DailyGifts a day, a claimed
// gift pays its item and XP, and an unclaimed one expires after DaysLimit days.
// The items besides the coins are the project's.
type GiftRules struct {
	Coins      int64      `json:"coins"`
	XP         int64      `json:"xp"`
	DailyGifts int        `json:"dailyGifts"`
	DaysLimit  int        `json:"daysLimit"`
	Items      []GiftItem `json:"items"`
}

// GiftItem is exactly one of coins, a stock (consumable) code or a spice code.
type GiftItem struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Coins int64  `json:"coins,omitempty"`
	Stock int    `json:"stock,omitempty"`
	Spice int    `json:"spice,omitempty"`
}

var neighborIDPattern = regexp.MustCompile(`^[a-z0-9]{15}$`)

func Neighbors() NeighborRules { return rules.Neighbors }

// NeighborByID finds a non-player neighbour.
func NeighborByID(id string) (Neighbor, bool) {
	for _, neighbor := range rules.Neighbors.List {
		if neighbor.ID == id {
			return neighbor, true
		}
	}
	return Neighbor{}, false
}

// NeighborsFor are the non-player neighbours a player of this level sees.
func NeighborsFor(level int) []Neighbor {
	list := []Neighbor{}
	for _, neighbor := range rules.Neighbors.List {
		if level >= neighbor.MinLevel {
			list = append(list, neighbor)
		}
	}
	return list
}

func Gifts() GiftRules { return rules.Gifts }

func GiftItemByID(id string) (GiftItem, bool) {
	for _, item := range rules.Gifts.Items {
		if item.ID == id {
			return item, true
		}
	}
	return GiftItem{}, false
}

func validateNeighbors(r Rules) string {
	n := r.Neighbors
	if n.HelpsPerDay < 1 || n.HelpReward.Coins < 0 || n.HelpReward.XP < 0 || n.HelpReward.Energy < 0 || len(n.List) == 0 {
		return "invalid neighbors"
	}
	recipes := map[string]bool{}
	for _, recipe := range r.Recipes {
		recipes[recipe.ID] = true
	}
	seen := map[string]bool{}
	for _, neighbor := range n.List {
		if !neighborIDPattern.MatchString(neighbor.ID) || seen[neighbor.ID] || neighbor.Name == "" || neighbor.CafeName == "" ||
			neighbor.Level < 1 || neighbor.Level > len(r.Levels) || !recipes[neighbor.Recipe] || neighbor.MinLevel < 0 {
			return "invalid neighbor " + neighbor.ID
		}
		seen[neighbor.ID] = true
	}
	g := r.Gifts
	if g.Coins < 0 || g.XP < 0 || g.DailyGifts < 1 || g.DaysLimit < 1 || len(g.Items) == 0 {
		return "invalid gifts"
	}
	items := map[string]bool{}
	for _, item := range g.Items {
		kinds := 0
		for _, set := range []bool{item.Coins > 0, item.Stock > 0, item.Spice > 0} {
			if set {
				kinds++
			}
		}
		if !recipeIDPattern.MatchString(item.ID) || items[item.ID] || item.Name == "" || kinds != 1 {
			return "invalid gift " + item.ID
		}
		items[item.ID] = true
	}
	return ""
}

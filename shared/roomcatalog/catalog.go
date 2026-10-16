package roomcatalog

import (
	"embed"
	"encoding/json"
	"slices"
)

//go:embed catalog.json
var files embed.FS

type Item struct {
	ID              int     `json:"id"`
	Classname       string  `json:"classname"`
	Name            string  `json:"name"`
	Type            int     `json:"type"`
	Kind            string  `json:"kind"`
	PriceGold       int64   `json:"priceGold"`
	Purchasable     bool    `json:"purchasable"`
	SizeX           int     `json:"sizeX"`
	SizeY           int     `json:"sizeY"`
	WallCutterIndex float64 `json:"wall_cutter_index,omitempty"`
	// Level is the player level the store sells the item from (0 or 1: always).
	Level int `json:"level,omitempty"`
	// PriceCash sells the item for Grana instead of coins (PriceGold is then 0).
	PriceCash int64 `json:"priceCash,omitempty"`
	// Charm is the decoration bonus of one placed unit, in popularity tenths
	// (gamerules.DecorBonus applies the limits per identical item and in total).
	Charm int `json:"charm,omitempty"`
	// Stoves only: cooking takes this share less time, and a ready dish lasts
	// this share longer before it spoils.
	CookSpeedPercent  int `json:"cookSpeedPercent,omitempty"`
	SpoilBonusPercent int `json:"spoilBonusPercent,omitempty"`
	// Featured items lead the store's Novidades tab.
	Featured bool `json:"featured,omitempty"`
	// Theme groups decoration sets (gamerules.DecorBonus pays a set bonus).
	Theme string `json:"theme,omitempty"`
	// Stoves only: every batch yields this share more servings (rounded up).
	ServingsBonusPercent int `json:"servingsBonusPercent,omitempty"`
}

// Themes are the decoration sets an item may belong to.
var Themes = []string{"japan", "italy", "noble"}

// MinLevel is the level the item is sold from.
func (i Item) MinLevel() int { return max(1, i.Level) }

// PaidWithCash reports whether buying the item costs Grana.
func (i Item) PaidWithCash() bool { return i.PriceCash > 0 }

var Items []Item

func init() {
	data, err := files.ReadFile("catalog.json")
	if err != nil {
		panic(err)
	}
	var catalog struct {
		Items []Item `json:"items"`
	}
	if err := json.Unmarshal(data, &catalog); err != nil {
		panic(err)
	}
	Items = catalog.Items
	seen := map[int]bool{}
	classNames := map[string]bool{}
	for _, item := range Items {
		if seen[item.ID] || classNames[item.Classname] || item.ID <= 0 || item.Classname == "" || item.SizeX < 1 || item.SizeY < 1 ||
			item.PriceGold < 0 || item.Type < 0 || item.Type > 3 ||
			(item.Type == 2 && (item.Kind != "door" || item.WallCutterIndex < 0 || item.WallCutterIndex > 1)) ||
			item.Level < 0 || item.Level > 260 || item.PriceCash < 0 || item.PriceCash > 0 && item.PriceGold > 0 ||
			item.Charm < 0 || item.Charm > 100 || item.CookSpeedPercent < 0 || item.CookSpeedPercent > 50 ||
			item.SpoilBonusPercent < 0 || item.SpoilBonusPercent > 200 ||
			item.Kind != "stove" && (item.CookSpeedPercent > 0 || item.SpoilBonusPercent > 0 || item.ServingsBonusPercent > 0) ||
			item.ServingsBonusPercent < 0 || item.ServingsBonusPercent > 100 || item.Theme != "" && !slices.Contains(Themes, item.Theme) {
			panic("invalid room catalogue")
		}
		seen[item.ID] = true
		classNames[item.Classname] = true
	}
}

func ByID(id int) (Item, bool) {
	for _, item := range Items {
		if item.ID == id {
			return item, true
		}
	}
	return Item{}, false
}

func Layer(item Item) string {
	if item.Type == 0 {
		return "floor"
	}
	if item.Type == 1 {
		return "wallpaper"
	}
	if item.Kind == "wall" {
		return "structure"
	}
	return "object"
}

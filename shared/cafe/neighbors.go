package cafe

import (
	"errors"
	"strings"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/roomcatalog"
)

// NeighborHelps counts each player's help in a neighbour's café per São Paulo
// day: (user, neighbor, day, count). The first row for a neighbour also marks
// a new neighbour helped (the amount_neighbors achievement).
const NeighborHelps = "neighbor_helps"

var ErrNotNeighbor = errors.New("Vizinho indisponível.")
var ErrHelpLimit = errors.New("Você já ajudou este vizinho o máximo de vezes hoje. Volte amanhã!")
var ErrHelpSelf = errors.New("No seu próprio café você trabalha, não ajuda.")

// NeighborView is one neighbour in the bottom bar and the map.
type NeighborView struct {
	ID string `json:"id"`
	// npc: a neighbour of the rules (its café is generated); player: another account.
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	CafeName string `json:"cafeName"`
	Level    int    `json:"level"`
	Theme    string `json:"theme,omitempty"`
	Tagline  string `json:"tagline,omitempty"`
	Special  int    `json:"special,omitempty"`
	// Help the player may still give there today, and whether today's gift went out.
	HelpsLeft int  `json:"helpsLeft"`
	GiftSent  bool `json:"giftSent,omitempty"`
}

type NeighborsSnapshot struct {
	Neighbors   []NeighborView           `json:"neighbors"`
	HelpsPerDay int                      `json:"helpsPerDay"`
	HelpReward  gamerules.NeighborReward `json:"helpReward"`
}

// HelpResult answers a help given in a neighbour's café.
type HelpResult struct {
	Action      string         `json:"action"`
	Coins       int64          `json:"coins"`
	XP          int64          `json:"xp"`
	Energy      int            `json:"energy"`
	HelpsLeft   int            `json:"helpsLeft"`
	LevelReward int64          `json:"levelReward,omitempty"`
	State       PlayerSnapshot `json:"state"`
}

// otherPlayers lists up to limit other accounts, the highest level first; the
// non-player neighbours are not among them.
func otherPlayers(s Store, user string, limit int) ([]Record, error) {
	rows, err := s.Find(PlayerCollection, Query{Sort: []string{"-level", "id"}, Limit: limit + 16})
	if err != nil {
		return nil, err
	}
	out := []Record{}
	for _, row := range rows {
		id := row.GetString("user")
		if _, npc := gamerules.NeighborByID(id); npc || id == user || id == "" {
			continue
		}
		out = append(out, row)
		if len(out) == limit {
			break
		}
	}
	return out, nil
}

// NeighborVisible: a non-player neighbour shows up (in the bar, for visits,
// helps and gifts) once the player reaches its minLevel; anyone else is not
// limited by level.
func NeighborVisible(s Store, user, id string) (bool, error) {
	neighbor, npc := gamerules.NeighborByID(id)
	if !npc || neighbor.MinLevel <= 1 {
		return true, nil
	}
	state, err := GetOrCreatePlayer(s, user)
	if err != nil {
		return false, err
	}
	return state.GetInt("level") >= neighbor.MinLevel, nil
}

// isNeighbor: a non-player neighbour the player's level shows, or another account with a café.
func isNeighbor(s Store, user, id string) (bool, error) {
	if id == "" || id == user {
		return false, nil
	}
	if _, npc := gamerules.NeighborByID(id); npc {
		return NeighborVisible(s, user, id)
	}
	if _, err := s.First(PlayerCollection, Where{"user": id}); errors.Is(err, ErrNotFound) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	return true, nil
}

func helpsToday(s Store, user, neighbor string, now time.Time) (Record, int, error) {
	row, err := s.First(NeighborHelps, Where{"user": user, "neighbor": neighbor, "day": bonusDate(now)})
	if errors.Is(err, ErrNotFound) {
		return nil, 0, nil
	}
	if err != nil {
		return nil, 0, err
	}
	return row, row.GetInt("count"), nil
}

// ListNeighbors: the non-player neighbours the player's level shows (special
// ones first), then up to 12 other players, with today's help and gift state.
func ListNeighbors(s Store, user string, now time.Time) (NeighborsSnapshot, error) {
	rules := gamerules.Neighbors()
	result := NeighborsSnapshot{Neighbors: []NeighborView{}, HelpsPerDay: rules.HelpsPerDay, HelpReward: rules.HelpReward}
	state, err := GetOrCreatePlayer(s, user)
	if err != nil {
		return result, err
	}
	add := func(view NeighborView) error {
		_, count, err := helpsToday(s, user, view.ID, now)
		if err != nil {
			return err
		}
		view.HelpsLeft = max(0, rules.HelpsPerDay-count)
		if _, err := s.First(PlayerGifts, Where{"from_user": user, "to_user": view.ID, "day": bonusDate(now)}); err == nil {
			view.GiftSent = true
		} else if !errors.Is(err, ErrNotFound) {
			return err
		}
		result.Neighbors = append(result.Neighbors, view)
		return nil
	}
	for _, special := range []bool{true, false} {
		for _, n := range gamerules.NeighborsFor(state.GetInt("level")) {
			if (n.Special != 0) != special {
				continue
			}
			if err := add(NeighborView{ID: n.ID, Kind: "npc", Name: n.Name, CafeName: n.CafeName, Level: n.Level, Theme: n.Theme, Tagline: n.Tagline, Special: n.Special}); err != nil {
				return result, err
			}
		}
	}
	players, err := otherPlayers(s, user, 12)
	if err != nil {
		return result, err
	}
	for _, row := range players {
		name := strings.TrimSpace(row.GetString("cafe_name"))
		if name == "" {
			name = "Café vizinho"
		}
		if err := add(NeighborView{ID: row.GetString("user"), Kind: "player", Name: name, CafeName: name, Level: max(1, row.GetInt("level"))}); err != nil {
			return result, err
		}
	}
	return result, nil
}

// HelpNeighbor pays the helper for one help (cleaning a table, seasoning a
// stove or cheering a customer up) in a neighbour's café, at most HelpsPerDay
// a day per neighbour. Callers run it in the transaction of the help itself.
func HelpNeighbor(s Store, helper, owner, action string, now time.Time) (HelpResult, error) {
	var result HelpResult
	if helper == owner {
		return result, ErrHelpSelf
	}
	err := s.Transaction(func(tx Store) error {
		neighbor, err := isNeighbor(tx, helper, owner)
		if err != nil {
			return err
		}
		if !neighbor {
			return ErrNotNeighbor
		}
		rules := gamerules.Neighbors()
		row, helped, err := helpsToday(tx, helper, owner, now)
		if err != nil {
			return err
		}
		if helped >= rules.HelpsPerDay {
			return ErrHelpLimit
		}
		if row == nil {
			// A neighbour helped for the first time counts for amount_neighbors.
			if _, err := tx.First(NeighborHelps, Where{"user": helper, "neighbor": owner}); errors.Is(err, ErrNotFound) {
				if err := count1(tx, helper, now, gamerules.StatNeighbors); err != nil {
					return err
				}
			} else if err != nil {
				return err
			}
			if row, err = tx.New(NeighborHelps); err != nil {
				return err
			}
			setAll(row, map[string]any{"user": helper, "neighbor": owner, "day": bonusDate(now), "count": 0})
		}
		row.Set("count", helped+1)
		if err := tx.Save(row); err != nil {
			return err
		}
		state, err := GetOrCreatePlayer(tx, helper)
		if err != nil {
			return err
		}
		reward := rules.HelpReward
		progress := Grant(state, reward.Coins, reward.XP)
		energy := RefillEnergy(state, reward.Energy, now)
		if err := tx.Save(state); err != nil {
			return err
		}
		if reward.Coins > 0 {
			if err := count(tx, helper, now, gamerules.StatEarnedCoins, reward.Coins); err != nil {
				return err
			}
		}
		result = HelpResult{Action: action, Coins: reward.Coins, XP: reward.XP, Energy: energy, HelpsLeft: rules.HelpsPerDay - helped - 1,
			LevelReward: progress.LevelReward, State: PlayerView(state)}
		return nil
	})
	return result, err
}

func count1(tx Store, user string, now time.Time, stat string) error {
	return count(tx, user, now, stat, 1)
}

// EnsureNeighborCafe gives a non-player neighbour its café the first time it is
// visited (the starter room in its theme, at its level) and, on each visit
// while its room sleeps, something to help with: a dish on the fire to season
// and plates on two tables to clear. An awake room keeps its dirt and cooking
// in the room server's memory, which would never see rows written here.
// Nothing is charged: the neighbour is not a player.
func EnsureNeighborCafe(s Store, id string, now time.Time) error {
	neighbor, ok := gamerules.NeighborByID(id)
	if !ok {
		return ErrNotNeighbor
	}
	if err := EnsureRoom(s, id); err != nil {
		return err
	}
	return s.Transaction(func(tx Store) error {
		state, err := tx.First(PlayerCollection, Where{"user": id})
		if err != nil {
			return err
		}
		first := state.GetString("cafe_name") != neighbor.CafeName
		if first {
			// First visit: name, level and the theme's floor and ornaments.
			state.Set("cafe_name", neighbor.CafeName)
			state.Set("level", neighbor.Level)
			xp := gamerules.Public().Levels[neighbor.Level-1].RequiredXP
			state.Set("experience_current", xp)
			state.Set("experience_max", max(xp, gamerules.NextLevelXP(neighbor.Level)))
			if err := tx.Save(state); err != nil {
				return err
			}
			if err := decorateNeighborCafe(tx, id, neighbor.Theme); err != nil {
				return err
			}
		}
		room, err := tx.First("player_rooms", Where{"user": id})
		if err != nil {
			return err
		}
		if !first && room.GetTime("slept_at").IsZero() {
			return nil
		}
		return refreshNeighborChores(tx, id, neighbor, now)
	})
}

// neighborSpots are floor tiles the starter room leaves free.
var neighborSpots = [][2]int{{1, 4}, {3, 7}, {5, 7}, {5, 2}}

func decorateNeighborCafe(tx Store, id, theme string) error {
	if theme == "" {
		return nil
	}
	var floor int
	ornaments := []roomcatalog.Item{}
	for _, item := range roomcatalog.Items {
		if item.Theme != theme {
			continue
		}
		if item.Type == 0 && floor == 0 {
			floor = item.ID
		}
		if item.Kind == "ornament" && item.SizeX == 1 && item.SizeY == 1 && len(ornaments) < len(neighborSpots) {
			ornaments = append(ornaments, item)
		}
	}
	if floor != 0 {
		floors, err := tx.Find("player_inventory", Query{Where: Where{"user": id, "layer": "floor"}, Limit: 1000})
		if err != nil {
			return err
		}
		for _, unit := range floors {
			unit.Set("item_id", floor)
			if err := tx.Save(unit); err != nil {
				return err
			}
		}
	}
	for i, item := range ornaments {
		unit, err := tx.New("player_inventory")
		if err != nil {
			return err
		}
		setAll(unit, map[string]any{"user": id, "item_id": item.ID, "tx": neighborSpots[i][0], "ty": neighborSpots[i][1], "rotation": 0,
			"placed": true, "layer": roomcatalog.Layer(item), "granted": true})
		if err := tx.Save(unit); err != nil {
			return err
		}
	}
	room, err := tx.First("player_rooms", Where{"user": id})
	if err != nil {
		return err
	}
	room.Set("revision", room.GetInt("revision")+1)
	return tx.Save(room)
}

// refreshNeighborChores puts the neighbour's dish on the fire (unless one is
// cooking or ready) and two plates on its tables (unless some are dirty).
func refreshNeighborChores(tx Store, id string, neighbor gamerules.Neighbor, now time.Time) error {
	stove, err := tx.First("player_stoves", Where{"user": id})
	if err != nil {
		return err
	}
	job, err := tx.First("stove_cooking", Where{"stove": stove.ID()})
	if err == nil {
		if status, _ := JobState(job, now); status == "spoiled" {
			if err := tx.Delete(job); err != nil {
				return err
			}
			job = nil
		}
	} else if errors.Is(err, ErrNotFound) {
		job = nil
	} else {
		return err
	}
	if job == nil {
		recipe, _ := gamerules.RecipeByID(neighbor.Recipe)
		model, _ := roomcatalog.ByID(stove.GetInt("item_id"))
		started := now.Add(gamerules.PrepareDuration())
		ready := started.Add(max(10*time.Minute, StoveCookDuration(model, recipe)))
		row, err := tx.New("stove_cooking")
		if err != nil {
			return err
		}
		setAll(row, map[string]any{"user": id, "stove": stove.ID(), "recipe_id": recipe.ID, "preparing_at": now, "started_at": started,
			"ready_at": ready, "spoils_at": ready.Add(StoveSpoilDuration(model, recipe)), "cost_coins": 0})
		if err := tx.Save(row); err != nil {
			return err
		}
	}
	if plates, err := tx.Find("room_dirt", Query{Where: Where{"user": id}, Limit: 1}); err != nil {
		return err
	} else if len(plates) > 0 {
		return nil
	}
	tables, err := tx.Find("player_inventory", Query{Where: Where{"user": id, "placed": true, "layer": "object"}, Sort: []string{"id"}, Limit: 1000})
	if err != nil {
		return err
	}
	dirty := 0
	for _, unit := range tables {
		if item, ok := roomcatalog.ByID(unit.GetInt("item_id")); !ok || item.Kind != "table" || dirty == 2 {
			continue
		}
		if err := leavePlate(tx, id, unit.ID()); err != nil {
			return err
		}
		dirty++
	}
	return nil
}

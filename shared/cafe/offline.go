package cafe

import (
	"errors"
	"math"
	"sort"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/roomcatalog"
)

// DiningSeat is a placed chair facing a table: the game server's chairTable
// rule (the tile in front of the chair, by rotation, holds the table).
type DiningSeat struct{ Chair, Table string }

func DiningSeats(units []Record) []DiningSeat {
	tables := map[[2]int]string{}
	for _, u := range units {
		item, ok := roomcatalog.ByID(u.GetInt("item_id"))
		if !ok || item.Kind != "table" {
			continue
		}
		sx, sy := item.SizeX, item.SizeY
		if u.GetInt("rotation")%2 == 1 {
			sx, sy = sy, sx
		}
		for y := 0; y < sy; y++ {
			for x := 0; x < sx; x++ {
				tables[[2]int{u.GetInt("tx") + x, u.GetInt("ty") + y}] = u.ID()
			}
		}
	}
	seats := []DiningSeat{}
	for _, u := range units {
		if item, ok := roomcatalog.ByID(u.GetInt("item_id")); !ok || item.Kind != "chair" {
			continue
		}
		d := [][2]int{{1, 0}, {0, 1}, {-1, 0}, {0, -1}}[u.GetInt("rotation")%4]
		if table := tables[[2]int{u.GetInt("tx") + d[0], u.GetInt("ty") + d[1]}]; table != "" {
			seats = append(seats, DiningSeat{u.ID(), table})
		}
	}
	sort.Slice(seats, func(i, j int) bool { return seats[i].Chair < seats[j].Chair })
	return seats
}

func hasDoor(units []Record) bool {
	for _, u := range units {
		if item, ok := roomcatalog.ByID(u.GetInt("item_id")); ok && item.Kind == "door" {
			return true
		}
	}
	return false
}

// catchUp replays an absence deterministically, as of the instants when each
// meal would have happened. Without staff every clean seat serves one meal and
// its table stays dirty; with a waiter or a cleaner the tables are cleared and
// the seats keep turning over. Meals are paced by the slowest of: customer
// arrivals at the café's popularity, seat turnover and waiter deliveries. Only
// gains are replayed: a café that runs out of food simply closes, it never
// loses popularity while nobody is there. Dishes stay on the stoves (serving
// them is the owner's job) and spoil by their own timestamps.
func catchUp(tx Store, owner string, from, to time.Time) (gamewire.AwaySummary, error) {
	rules := gamerules.Offline()
	until := to
	if limit := from.Add(time.Duration(rules.MaxAwaySeconds) * time.Second); until.After(limit) {
		until = limit
	}
	summary := gamewire.AwaySummary{From: from.UnixMilli(), To: to.UnixMilli(), Simulated: until.Sub(from).Milliseconds(), Capped: to.Sub(until).Milliseconds()}
	state, err := tx.First(PlayerCollection, Where{"user": owner})
	if err != nil {
		return summary, err
	}
	summary.LevelFrom, summary.PopularityFrom = max(1, state.GetInt("level")), state.GetInt("satisfaction_current_tenths")
	staff, err := RoomStaff(tx, owner)
	if err != nil {
		return summary, err
	}
	for _, m := range staff {
		if m.Role == gamerules.RoleWaiter {
			summary.Waiters++
		} else {
			summary.Cleaners++
		}
	}
	units, err := tx.Find("player_inventory", Query{Where: Where{"user": owner, "placed": true}, Sort: []string{"id"}})
	if err != nil {
		return summary, err
	}
	seats := DiningSeats(units)
	if !hasDoor(units) {
		// No door, no customers: the live room never spawns them either.
		seats = nil
	}
	dirt, err := RoomDirt(tx, owner)
	if err != nil {
		return summary, err
	}
	dirty := map[string]bool{}
	for _, d := range dirt {
		dirty[d.TableID] = true
	}
	foods, err := tx.Find("room_food", Query{Where: Where{"user": owner}, Sort: []string{"created", "id"}})
	if err != nil {
		return summary, err
	}
	servings := map[string]int{}
	total := 0
	for _, food := range foods {
		servings[food.ID()] = max(1, food.GetInt("servings"))
		total += servings[food.ID()]
	}

	cleaning := summary.Waiters+summary.Cleaners > 0
	turns := []DiningSeat{}
	for _, seat := range seats {
		if cleaning || !dirty[seat.Table] {
			turns = append(turns, seat)
		}
	}
	meals := 0
	pace := 0.0
	if len(turns) > 0 && total > 0 {
		// Arrivals follow the score customers see: service plus decoration.
		decor, err := RoomDecor(tx, owner)
		if err != nil {
			return summary, err
		}
		popularity := gamerules.EffectivePopularity(summary.PopularityFrom, decor.BonusTenths)
		pace = math.Max(60/float64(gamerules.CustomersPerMinute(popularity)), float64(rules.SeatCycleSeconds)/float64(len(seats)))
		if summary.Waiters > 0 {
			pace = math.Max(pace, float64(rules.DeliverySeconds)/float64(summary.Waiters))
		}
		meals = min(total, int(until.Sub(from).Seconds()/pace))
		if !cleaning {
			meals = min(meals, len(turns))
		}
	}
	food := 0
	for i := 0; i < meals; i++ {
		for food < len(foods) && servings[foods[food].ID()] == 0 {
			food++
		}
		if food == len(foods) {
			break
		}
		at := from.Add(time.Duration(float64(i+1) * pace * float64(time.Second)))
		payment, err := ServeServing(tx, owner, foods[food].ID(), turns[i%len(turns)].Table, gamewire.ServeOptions{Waiter: summary.Waiters > 0}, at)
		if errors.Is(err, ErrFoodGone) {
			servings[foods[food].ID()] = 0
			continue
		}
		if err != nil {
			return summary, err
		}
		servings[foods[food].ID()]--
		summary.Served++
		summary.Coins += payment.Coins
		summary.Tips += payment.Tip
		summary.FreshCoins += payment.FreshCoins
		summary.XP += payment.XP
	}
	if cleaning {
		dirt, err = RoomDirt(tx, owner)
		if err != nil {
			return summary, err
		}
		for _, d := range dirt {
			cleared, err := CleanTable(tx, owner, d.TableID, false)
			if err != nil && !errors.Is(err, ErrTableClean) {
				return summary, err
			}
			summary.Cleared += cleared
		}
	}
	if dirt, err = RoomDirt(tx, owner); err != nil {
		return summary, err
	}
	for _, d := range dirt {
		summary.Plates += d.Plates
	}
	for _, left := range servings {
		summary.ServingsLeft += left
	}
	jobs, err := tx.Find("stove_cooking", Query{Where: Where{"user": owner}})
	if err != nil {
		return summary, err
	}
	for _, job := range jobs {
		switch status, _ := JobState(job, to); status {
		case "ready":
			summary.ReadyDishes++
		case "spoiled":
			summary.SpoiledDish++
		}
	}
	if state, err = tx.First(PlayerCollection, Where{"user": owner}); err != nil {
		return summary, err
	}
	summary.LevelTo, summary.PopularityTo = max(1, state.GetInt("level")), state.GetInt("satisfaction_current_tenths")
	return summary, nil
}

// mergeAway adds a new absence to one the owner has not seen yet.
func mergeAway(seen *gamewire.AwaySummary, next gamewire.AwaySummary) gamewire.AwaySummary {
	if seen == nil {
		return next
	}
	merged := next
	merged.From, merged.LevelFrom, merged.PopularityFrom = seen.From, seen.LevelFrom, seen.PopularityFrom
	merged.Simulated += seen.Simulated
	merged.Capped += seen.Capped
	merged.Served += seen.Served
	merged.Coins += seen.Coins
	merged.Tips += seen.Tips
	merged.FreshCoins += seen.FreshCoins
	merged.XP += seen.XP
	merged.Cleared += seen.Cleared
	return merged
}

func awaySummary(room Record) *gamewire.AwaySummary {
	var summary gamewire.AwaySummary
	if raw := room.GetString("away_summary"); raw == "" || raw == "null" || room.UnmarshalJSONField("away_summary", &summary) != nil || summary.To == 0 {
		return nil
	}
	return &summary
}

// WakeRoom runs when the room server loads a sleeping café. Clearing slept_at
// in the same transaction makes the catch-up happen once, even if two loads
// race. Customers saved at sleep went home during a real absence.
func WakeRoom(s Store, owner string, now time.Time) (*gamewire.AwaySummary, error) {
	var result *gamewire.AwaySummary
	err := s.Transaction(func(tx Store) error {
		room, err := tx.First("player_rooms", Where{"user": owner})
		if err != nil {
			return err
		}
		result = awaySummary(room)
		slept := room.GetTime("slept_at")
		if slept.IsZero() {
			return nil
		}
		room.Set("slept_at", "")
		if now.Sub(slept) < time.Duration(gamerules.Offline().MinAwaySeconds)*time.Second {
			return tx.Save(room)
		}
		// The catch-up saves the room itself (the tip jar fills with each
		// meal): clear slept_at first, then write the summary on a fresh read.
		if err := tx.Save(room); err != nil {
			return err
		}
		summary, err := catchUp(tx, owner, slept, now)
		if err != nil {
			return err
		}
		if room, err = tx.First("player_rooms", Where{"user": owner}); err != nil {
			return err
		}
		merged := mergeAway(result, summary)
		result = &merged
		room.Set("away_summary", merged)
		if err := tx.Save(room); err != nil {
			return err
		}
		npcs, err := tx.Find("room_npcs", Query{Where: Where{"user": owner}})
		if err != nil {
			return err
		}
		for _, npc := range npcs {
			if err := tx.Delete(npc); err != nil {
				return err
			}
		}
		return nil
	})
	return result, err
}

// AcknowledgeAway clears the summary once the owner has seen it. The read
// runs inside the write transaction: a stale read saved back over a wake that
// committed meanwhile would restore slept_at and replay the absence again.
func AcknowledgeAway(s Store, owner string) error {
	return s.Transaction(func(tx Store) error {
		room, err := tx.First("player_rooms", Where{"user": owner})
		if err != nil {
			return err
		}
		room.Set("away_summary", nil)
		return tx.Save(room)
	})
}

package main

import (
	"database/sql"
	"errors"
	"math"
	"sort"
	"time"

	"coffe-mania/database/playerstate"
	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/roomcatalog"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// diningSeat is a placed chair facing a table: the game server's chairTable
// rule (the tile in front of the chair, by rotation, holds the table).
type diningSeat struct{ chair, table string }

func diningSeats(units []*core.Record) []diningSeat {
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
				tables[[2]int{u.GetInt("tx") + x, u.GetInt("ty") + y}] = u.Id
			}
		}
	}
	seats := []diningSeat{}
	for _, u := range units {
		if item, ok := roomcatalog.ByID(u.GetInt("item_id")); !ok || item.Kind != "chair" {
			continue
		}
		d := [][2]int{{1, 0}, {0, 1}, {-1, 0}, {0, -1}}[u.GetInt("rotation")%4]
		if table := tables[[2]int{u.GetInt("tx") + d[0], u.GetInt("ty") + d[1]}]; table != "" {
			seats = append(seats, diningSeat{u.Id, table})
		}
	}
	sort.Slice(seats, func(i, j int) bool { return seats[i].chair < seats[j].chair })
	return seats
}

// catchUp replays an absence deterministically, as of the instants when each
// meal would have happened. Without staff every clean seat serves one meal and
// its table stays dirty; with a waiter or a cleaner the tables are cleared and
// the seats keep turning over. Meals are paced by the slowest of: customer
// arrivals at the café's popularity, seat turnover and waiter deliveries. Only
// gains are replayed: a café that runs out of food simply closes, it never
// loses popularity while nobody is there. Dishes stay on the stoves (serving
// them is the owner's job) and spoil by their own timestamps.
func catchUp(tx core.App, owner string, from, to time.Time) (gamewire.AwaySummary, error) {
	rules := gamerules.Offline()
	until := to
	if limit := from.Add(time.Duration(rules.MaxAwaySeconds) * time.Second); until.After(limit) {
		until = limit
	}
	summary := gamewire.AwaySummary{From: from.UnixMilli(), To: to.UnixMilli(), Simulated: until.Sub(from).Milliseconds()}
	state, err := tx.FindFirstRecordByData(playerstate.Collection, "user", owner)
	if err != nil {
		return summary, err
	}
	summary.LevelFrom, summary.PopularityFrom = max(1, state.GetInt("level")), state.GetInt("satisfaction_current_tenths")
	staff, err := roomStaff(tx, owner)
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
	units, err := tx.FindRecordsByFilter("player_inventory", "user={:user} && placed=true", "id", 0, 0, dbx.Params{"user": owner})
	if err != nil {
		return summary, err
	}
	seats := diningSeats(units)
	dirt, err := roomDirt(tx, owner)
	if err != nil {
		return summary, err
	}
	dirty := map[string]bool{}
	for _, d := range dirt {
		dirty[d.TableID] = true
	}
	foods, err := tx.FindRecordsByFilter("room_food", "user={:owner}", "created,id", 0, 0, dbx.Params{"owner": owner})
	if err != nil {
		return summary, err
	}
	servings := map[string]int{}
	total := 0
	for _, food := range foods {
		servings[food.Id] = max(1, food.GetInt("servings"))
		total += servings[food.Id]
	}

	cleaning := summary.Waiters+summary.Cleaners > 0
	turns := []diningSeat{}
	for _, seat := range seats {
		if cleaning || !dirty[seat.table] {
			turns = append(turns, seat)
		}
	}
	meals := 0
	pace := 0.0
	if len(turns) > 0 && total > 0 {
		pace = math.Max(60/float64(gamerules.CustomersPerMinute(summary.PopularityFrom)), float64(rules.SeatCycleSeconds)/float64(len(seats)))
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
		for food < len(foods) && servings[foods[food].Id] == 0 {
			food++
		}
		if food == len(foods) {
			break
		}
		at := from.Add(time.Duration(float64(i+1) * pace * float64(time.Second)))
		payment, err := serveServing(tx, owner, foods[food].Id, turns[i%len(turns)].table, summary.Waiters > 0, at)
		if errors.Is(err, errFoodGone) {
			servings[foods[food].Id] = 0
			continue
		}
		if err != nil {
			return summary, err
		}
		servings[foods[food].Id]--
		summary.Served++
		summary.Coins += payment.Coins
		summary.Tips += payment.Tip
		summary.FreshCoins += payment.FreshCoins
		summary.XP += payment.XP
	}
	if cleaning {
		dirt, err = roomDirt(tx, owner)
		if err != nil {
			return summary, err
		}
		for _, d := range dirt {
			cleared, err := cleanTable(tx, owner, d.TableID, false)
			if err != nil && !errors.Is(err, errTableClean) {
				return summary, err
			}
			summary.Cleared += cleared
		}
	}
	if dirt, err = roomDirt(tx, owner); err != nil {
		return summary, err
	}
	for _, d := range dirt {
		summary.Plates += d.Plates
	}
	for _, left := range servings {
		summary.ServingsLeft += left
	}
	jobs, err := tx.FindRecordsByFilter("stove_cooking", "user={:user}", "", 0, 0, dbx.Params{"user": owner})
	if err != nil {
		return summary, err
	}
	now := types.NowDateTime()
	for _, job := range jobs {
		switch status, _ := jobState(job, now); status {
		case "ready":
			summary.ReadyDishes++
		case "spoiled":
			summary.SpoiledDish++
		}
	}
	if state, err = tx.FindFirstRecordByData(playerstate.Collection, "user", owner); err != nil {
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
	merged.Served += seen.Served
	merged.Coins += seen.Coins
	merged.Tips += seen.Tips
	merged.FreshCoins += seen.FreshCoins
	merged.XP += seen.XP
	merged.Cleared += seen.Cleared
	return merged
}

func awaySummary(room *core.Record) *gamewire.AwaySummary {
	var summary gamewire.AwaySummary
	if raw := room.GetString("away_summary"); raw == "" || raw == "null" || room.UnmarshalJSONField("away_summary", &summary) != nil || summary.To == 0 {
		return nil
	}
	return &summary
}

// wakeRoom runs when the room server loads a sleeping café. Clearing slept_at
// in the same transaction makes the catch-up happen once, even if two loads
// race. Customers saved at sleep went home during a real absence.
func wakeRoom(app core.App, owner string, now time.Time) (*gamewire.AwaySummary, error) {
	var result *gamewire.AwaySummary
	err := app.RunInTransaction(func(tx core.App) error {
		room, err := tx.FindFirstRecordByData("player_rooms", "user", owner)
		if err != nil {
			return err
		}
		result = awaySummary(room)
		slept := room.GetDateTime("slept_at")
		if slept.IsZero() {
			return nil
		}
		room.Set("slept_at", "")
		if now.Sub(slept.Time()) < time.Duration(gamerules.Offline().MinAwaySeconds)*time.Second {
			return tx.Save(room)
		}
		summary, err := catchUp(tx, owner, slept.Time(), now)
		if err != nil {
			return err
		}
		merged := mergeAway(result, summary)
		result = &merged
		room.Set("away_summary", merged)
		if err := tx.Save(room); err != nil {
			return err
		}
		npcs, err := tx.FindRecordsByFilter("room_npcs", "user={:owner}", "", 0, 0, dbx.Params{"owner": owner})
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
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

// acknowledgeAway clears the summary once the owner has seen it.
func acknowledgeAway(app core.App, owner string) error {
	room, err := app.FindFirstRecordByData("player_rooms", "user", owner)
	if err != nil {
		return err
	}
	room.Set("away_summary", nil)
	return app.Save(room)
}

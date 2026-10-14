package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"testing"
	"time"

	"coffe-mania/shared/cafe"
	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
)

// parityLog plays one café through the shared rules and writes down what a
// player could observe, without ids or wall-clock instants, so two stores can
// be compared line by line.
func parityLog(t *testing.T, s cafe.Store, owner string, t0 time.Time) []string {
	t.Helper()
	lines := []string{}
	log := func(label string, value any) {
		data, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		lines = append(lines, label+" "+string(data))
	}
	outcome := func(err error) string {
		if err == nil {
			return "ok"
		}
		return err.Error()
	}
	offset := func(value string) string {
		if value == "" {
			return ""
		}
		at, err := time.Parse(cafe.TimeLayout, value)
		if err != nil {
			t.Fatalf("bad time %q", value)
		}
		return at.Sub(t0).Round(time.Millisecond).String()
	}
	positions := map[string]string{}
	room := func(label string) cafe.RoomSnapshot {
		snapshot, err := cafe.SnapshotRoom(s, owner)
		if err != nil {
			t.Fatal(err)
		}
		units := []string{}
		for _, u := range snapshot.Inventory {
			positions[u.UnitID] = fmt.Sprintf("%d@%d,%d/%d", u.ItemID, u.TX, u.TY, u.Rotation)
			units = append(units, fmt.Sprintf("%s placed=%t stove=%t", positions[u.UnitID], u.Placed, u.StoveID != ""))
		}
		sort.Strings(units)
		log(label, map[string]any{"revision": snapshot.Revision, "tiles": [2]int{snapshot.TilesX, snapshot.TilesY}, "player": snapshot.PlayerState, "units": units, "away": snapshot.AwaySummary != nil})
		return snapshot
	}
	street := func(label string, state gamewire.Street, err error) {
		at := func(ms int64) string {
			if ms == 0 {
				return ""
			}
			return time.UnixMilli(ms).Sub(t0).Round(time.Millisecond).String()
		}
		log(label, map[string]any{"err": outcome(err), "fresh": state.FreshCharges, "farm": at(state.FarmReadyAt), "party": [3]string{at(state.PartyStartedAt), at(state.PartyEndsAt), at(state.PartyReadyAt)}})
	}
	cooking := func(label string, now time.Time) {
		snapshot, err := cafe.SnapshotCooking(s, owner, now)
		if err != nil {
			t.Fatal(err)
		}
		stoves := []map[string]any{}
		for _, stove := range snapshot.Stoves {
			view := map[string]any{"item": stove.ItemID, "at": [2]int{stove.TX, stove.TY}}
			if c := stove.Cooking; c != nil {
				view["cooking"] = []any{c.RecipeID, c.Status, c.Servings, c.Seasoned, c.Fresh, offset(c.PreparingAt), offset(c.StartedAt), offset(c.ReadyAt), offset(c.SpoilsAt)}
			}
			stoves = append(stoves, view)
		}
		log(label, map[string]any{"now": offset(snapshot.ServerNow), "stoves": stoves, "emergency": snapshot.EmergencyRecipeID})
	}
	world := func(label string) gamewire.World {
		w, err := cafe.PublicWorld(s, owner, t0)
		if err != nil {
			t.Fatal(err)
		}
		foods := []string{}
		for _, f := range w.Foods {
			foods = append(foods, fmt.Sprintf("%s x%d fresh=%d on %s", f.Recipe, f.Servings, f.Fresh, positions[f.CounterID]))
		}
		dirt := []string{}
		for _, d := range w.Dirt {
			dirt = append(dirt, fmt.Sprintf("%s plates=%d", positions[d.TableID], d.Plates))
		}
		sort.Strings(dirt)
		staff := []string{}
		for _, m := range w.Staff {
			staff = append(staff, m.Profile+"/"+m.Name+"/"+m.Role)
		}
		log(label, map[string]any{"units": len(w.Units), "foods": foods, "dirt": dirt, "staff": staff})
		return w
	}
	unitAt := func(snapshot cafe.RoomSnapshot, item, x, y int) string {
		for _, u := range snapshot.Inventory {
			if u.ItemID == item && u.TX == x && u.TY == y && u.Placed {
				return u.UnitID
			}
		}
		t.Fatalf("no unit %d at %d,%d", item, x, y)
		return ""
	}

	log("player", outcome(func() error { _, err := cafe.GetOrCreatePlayer(s, owner); return err }()))
	log("room", outcome(cafe.EnsureRoom(s, owner)))
	start := room("starter")
	stove, err := s.First("player_stoves", cafe.Where{"user": owner})
	if err != nil {
		t.Fatal(err)
	}
	firstTable, secondTable := unitAt(start, 3030010, 3, 3), unitAt(start, 3030010, 3, 5)
	cooking("idle kitchen", t0)

	state, err := cafe.HarvestFarm(s, owner, t0)
	street("harvest", state, err)
	state, err = cafe.HarvestFarm(s, owner, t0.Add(time.Minute))
	street("harvest again", state, err)

	pao, _ := gamerules.RecipeByID("pao_de_queijo")
	log("cook", outcome(cafe.StartCooking(s, owner, stove.ID(), pao.ID, t0)))
	log("cook twice", outcome(cafe.StartCooking(s, owner, stove.ID(), pao.ID, t0)))
	log("season", outcome(cafe.SeasonCooking(s, owner, owner, stove.ID(), t0.Add(time.Second))))
	cooking("cooking", t0.Add(3*time.Second))
	ready := t0.Add(gamerules.PrepareDuration() + pao.CookDuration())
	log("serve early", outcome(cafe.ServeCooking(s, owner, stove.ID(), ready.Add(-time.Second))))
	log("serve", outcome(cafe.ServeCooking(s, owner, stove.ID(), ready)))
	w := world("counter")
	if len(w.Foods) != 1 {
		t.Fatalf("foods = %+v", w.Foods)
	}
	for i, table := range []string{firstTable, secondTable, firstTable} {
		payment, err := cafe.ServeServing(s, owner, w.Foods[0].ID, table, i == 2, ready.Add(time.Duration(i+1)*time.Second))
		log(fmt.Sprintf("payment %d", i), map[string]any{"err": outcome(err), "payment": payment})
	}
	world("after meals")
	plates, err := cafe.CleanTable(s, owner, firstTable, true)
	log("clean", map[string]any{"err": outcome(err), "plates": plates})
	_, err = cafe.CleanTable(s, owner, firstTable, true)
	log("clean again", outcome(err))
	popularity, err := cafe.RecordVerdict(s, owner, false)
	log("verdict", map[string]any{"err": outcome(err), "popularity": popularity})

	log("hire", outcome(cafe.HireStaff(s, owner, "vostu", "")))
	log("hire again", outcome(cafe.HireStaff(s, owner, "vostu", "")))
	staff, err := cafe.SnapshotStaff(s, owner)
	if err != nil {
		t.Fatal(err)
	}
	members := []string{}
	for _, m := range staff.Staff {
		members = append(members, m.Profile+"/"+m.Role)
	}
	log("staff", map[string]any{"level": staff.Level, "slots": staff.Slots, "hire": staff.HireCoins, "paid": staff.PaidSlots, "members": members})

	state, err = cafe.StartParty(s, owner, ready)
	street("party", state, err)
	state, err = cafe.StartParty(s, owner, ready.Add(time.Minute))
	street("party again", state, err)

	revision := start.Revision
	x, y, rotation := 3, 4, 0
	bought, err := cafe.MutateRoom(s, owner, "purchase", cafe.RoomCommand{ItemID: 9000001, TX: &x, TY: &y, Rotation: &rotation, Revision: &revision, RequestID: "parity-purchase-floor-1"})
	log("purchase", map[string]any{"err": outcome(err), "revision": bought.Revision, "gold": bought.PlayerState.Gold})
	_, err = cafe.MutateRoom(s, owner, "purchase", cafe.RoomCommand{ItemID: 9000001, TX: &x, TY: &y, Rotation: &rotation, Revision: &revision, RequestID: "parity-purchase-floor-1"})
	log("purchase repeated", outcome(err))
	_, err = cafe.MutateRoom(s, owner, "move", cafe.RoomCommand{UnitID: secondTable, TX: &x, TY: &y, Rotation: &rotation, Revision: &bought.Revision, RequestID: "parity-move-dirty-table"})
	log("move dirty table", outcome(err))

	expansion, err := cafe.ExpandRoom(s, owner, 10, "cash")
	log("expand", map[string]any{"err": outcome(err), "tiles": expansion.Tiles, "cash": expansion.Cash, "reward": expansion.RewardCoins, "xp": expansion.XP, "level": expansion.Level})
	_, err = cafe.ExpandRoom(s, owner, 10, "cash")
	log("expand again", outcome(err))
	room("expanded")

	npc := gamewire.Actor{ID: "npc:parity", Kind: "npc", State: "seated", X: 2, Y: 3}
	log("sleep", outcome(cafe.SaveDormant(s, owner, gamewire.Sleep{NPCs: []gamewire.Actor{npc}}, t0)))
	seed, err := cafe.LoadSeed(s, owner, t0.Add(time.Minute))
	log("short wake", map[string]any{"err": outcome(err), "npcs": len(seed.NPCs), "looks": len(seed.Looks), "away": seed.Away != nil, "popularity": seed.PopularityTenths})
	log("sleep again", outcome(cafe.SaveDormant(s, owner, gamewire.Sleep{NPCs: []gamewire.Actor{npc}}, t0)))
	summary, err := cafe.WakeRoom(s, owner, t0.Add(2*time.Hour))
	if summary != nil {
		log("long wake", map[string]any{"err": outcome(err), "span": summary.To - summary.From, "simulated": summary.Simulated, "served": summary.Served, "coins": summary.Coins, "tips": summary.Tips, "xp": summary.XP, "cleared": summary.Cleared, "plates": summary.Plates, "left": summary.ServingsLeft, "waiters": summary.Waiters, "level": [2]int{summary.LevelFrom, summary.LevelTo}, "popularity": [2]int{summary.PopularityFrom, summary.PopularityTo}})
	} else {
		log("long wake", outcome(err))
	}
	room("after the absence")
	log("acknowledge", outcome(cafe.AcknowledgeAway(s, owner)))
	room("acknowledged")
	world("final")
	return lines
}

// The server (PocketBase) and the standalone build (memory) run the same
// rules; this game, played on both, must look the same on both.
func TestMemoryStoreMatchesPocketBase(t *testing.T) {
	app, owner := newEconomyApp(t)
	t0 := time.Now().UTC().Truncate(time.Millisecond)
	server := parityLog(t, pb(app), owner, t0)
	browser := parityLog(t, cafe.NewMemoryStore(), owner, t0)
	if len(server) != len(browser) {
		t.Fatalf("%d lines on the server, %d in memory", len(server), len(browser))
	}
	for i := range server {
		if server[i] != browser[i] {
			t.Errorf("line %d differs\nserver: %s\nmemory: %s", i, server[i], browser[i])
		}
	}
	if testing.Verbose() {
		for _, line := range server {
			t.Log(line)
		}
	}
}

// A saved café loads back with the same data, including dates and JSON fields.
func TestMemoryStoreSaveRoundTrip(t *testing.T) {
	t0 := time.Now().UTC().Truncate(time.Millisecond)
	store := cafe.NewMemoryStore()
	first := parityLog(t, store, "player", t0)
	saved, err := store.Export()
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := cafe.LoadMemoryStore(saved)
	if err != nil {
		t.Fatal(err)
	}
	again, err := loaded.Export()
	if err != nil {
		t.Fatal(err)
	}
	var a, b any
	if json.Unmarshal(saved, &a) != nil || json.Unmarshal(again, &b) != nil {
		t.Fatal("invalid save")
	}
	if fmt.Sprint(a) != fmt.Sprint(b) {
		t.Fatal("the save changed after loading it back")
	}
	if len(first) == 0 {
		t.Fatal("empty game")
	}
	snapshot, err := cafe.SnapshotRoom(loaded, "player")
	if err != nil || snapshot.TilesX != 10 || snapshot.PlayerState.Level < 1 {
		t.Fatalf("loaded room = %+v (%v)", snapshot, err)
	}
}

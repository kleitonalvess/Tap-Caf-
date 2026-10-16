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
	// Crates and random spices draw the same sequence on both stores.
	draws, previous := 0, cafe.RandomIntn
	cafe.RandomIntn = func(n int) int { draws++; return draws % n }
	t.Cleanup(func() { cafe.RandomIntn = previous })
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
	log("season", outcome(cafe.SeasonCooking(s, owner, owner, stove.ID(), 0, t0.Add(time.Second))))
	cooking("cooking", t0.Add(3*time.Second))
	ready := t0.Add(gamerules.PrepareDuration() + pao.CookDuration())
	log("serve early", outcome(cafe.ServeCooking(s, owner, stove.ID(), ready.Add(-time.Second))))
	seasonXP, err := cafe.ServeCookingXP(s, owner, stove.ID(), ready)
	log("serve", map[string]any{"err": outcome(err), "seasonXp": seasonXP})
	w := world("counter")
	if len(w.Foods) != 1 {
		t.Fatalf("foods = %+v", w.Foods)
	}
	// The second meal is the critic's (Sprint 16): multiplied pay, popularity and tip jar.
	for i, table := range []string{firstTable, secondTable, firstTable} {
		options := gamewire.ServeOptions{Waiter: i == 2}
		if i == 1 {
			options.VIP = "critic_initial"
		}
		payment, err := cafe.ServeServing(s, owner, w.Foods[0].ID, table, options, ready.Add(time.Duration(i+1)*time.Second))
		log(fmt.Sprintf("payment %d", i), map[string]any{"err": outcome(err), "payment": payment})
	}
	world("after meals")
	plates, err := cafe.CleanTableAt(s, owner, firstTable, true, ready)
	log("clean", map[string]any{"err": outcome(err), "plates": plates})
	_, err = cafe.CleanTableAt(s, owner, firstTable, true, ready)
	log("clean again", outcome(err))
	popularity, err := cafe.RecordVerdict(s, owner, false)
	log("verdict", map[string]any{"err": outcome(err), "popularity": popularity})

	log("hire", outcome(cafe.HireStaff(s, owner, "vostu", "", t0)))
	log("hire again", outcome(cafe.HireStaff(s, owner, "vostu", "", t0)))
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
	bought, err := cafe.MutateRoom(s, owner, "purchase", cafe.RoomCommand{ItemID: 9000001, TX: &x, TY: &y, Rotation: &rotation, Revision: &revision, RequestID: "parity-purchase-floor-1"}, t0)
	log("purchase", map[string]any{"err": outcome(err), "revision": bought.Revision, "gold": bought.PlayerState.Gold})
	_, err = cafe.MutateRoom(s, owner, "purchase", cafe.RoomCommand{ItemID: 9000001, TX: &x, TY: &y, Rotation: &rotation, Revision: &revision, RequestID: "parity-purchase-floor-1"}, t0)
	log("purchase repeated", outcome(err))
	_, err = cafe.MutateRoom(s, owner, "move", cafe.RoomCommand{UnitID: secondTable, TX: &x, TY: &y, Rotation: &rotation, Revision: &bought.Revision, RequestID: "parity-move-dirty-table"}, t0)
	log("move dirty table", outcome(err))

	expansion, err := cafe.ExpandRoom(s, owner, 10, "cash", t0)
	log("expand", map[string]any{"err": outcome(err), "tiles": expansion.Tiles, "cash": expansion.Cash, "reward": expansion.RewardCoins, "xp": expansion.XP, "level": expansion.Level})
	_, err = cafe.ExpandRoom(s, owner, 10, "cash", t0)
	log("expand again", outcome(err))
	room("expanded")

	npc := gamewire.Actor{ID: "npc:parity", Kind: "npc", State: "seated", X: 2, Y: 3, VIP: "rock_jagger"}
	log("sleep", outcome(cafe.SaveDormant(s, owner, gamewire.Sleep{NPCs: []gamewire.Actor{npc}}, t0)))
	seed, err := cafe.LoadSeed(s, owner, t0.Add(time.Minute))
	wokenVIP := ""
	if len(seed.NPCs) > 0 {
		wokenVIP = seed.NPCs[0].VIP
	}
	log("short wake", map[string]any{"err": outcome(err), "npcs": len(seed.NPCs), "vip": wokenVIP, "looks": len(seed.Looks), "away": seed.Away != nil, "popularity": seed.PopularityTenths, "level": seed.Level})
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

	// Sprint 11: daily bonus, mail and the refund of a cancelled batch.
	for _, at := range []time.Time{t0, t0.Add(time.Minute), t0.Add(24 * time.Hour), t0.Add(72 * time.Hour)} {
		claim, err := cafe.ClaimDaily(s, owner, at)
		log("daily", map[string]any{"err": outcome(err), "reward": claim.Reward, "day": claim.Daily.Day, "claimable": claim.Daily.Claimable, "gold": claim.State.Gold, "cash": claim.State.Cash})
	}
	mail, err := cafe.SnapshotMail(s, owner)
	log("mail", map[string]any{"err": outcome(err), "letters": len(mail.Letters), "unread": mail.Unread})
	if len(mail.Letters) > 0 {
		letter, err := cafe.ClaimLetter(s, owner, mail.Letters[0].ID, t0)
		log("letter", map[string]any{"err": outcome(err), "title": letter.Letter.Title, "claimed": letter.Letter.Claimed, "gold": letter.State.Gold})
		_, err = cafe.ClaimLetter(s, owner, mail.Letters[0].ID, t0)
		log("letter again", outcome(err))
	}
	if stoves, err := cafe.SnapshotCooking(s, owner, t0); err == nil && len(stoves.Stoves) > 0 {
		stove := stoves.Stoves[0].ID
		cancelled := t0.Add(3 * time.Hour)
		log("cook to cancel", outcome(cafe.StartCooking(s, owner, stove, "pao_de_queijo", cancelled)))
		refund, err := cafe.CancelCooking(s, owner, stove, cancelled.Add(gamerules.PrepareDuration()+time.Second))
		log("cancel while cooking", map[string]any{"err": outcome(err), "refund": refund})
		room("refunded")
	}

	// Sprint 12: counters, achievements, daily missions and the café's name.
	progressAt := t0.Add(3 * time.Hour)
	showProgress := func(label string, p cafe.ProgressSnapshot) {
		achievements := []string{}
		for _, a := range p.Achievements {
			achievements = append(achievements, fmt.Sprintf("%s %d/%d claimed=%d claimable=%t", a.ID, a.Progress, len(a.Goals), a.Claimed, a.Claimable))
		}
		missions := []string{}
		for _, m := range p.Missions {
			missions = append(missions, fmt.Sprintf("%s %+v complete=%t claimed=%t", m.ID, m.Goals, m.Complete, m.Claimed))
		}
		log(label, map[string]any{"achievements": achievements, "missions": missions, "ready": p.Ready})
	}
	progress, err := cafe.SnapshotProgress(s, owner, progressAt)
	if err != nil {
		t.Fatal(err)
	}
	showProgress("progress", progress)
	for _, id := range []string{"expansions", "expansions", "customers", "served_dishes"} {
		claim, err := cafe.ClaimAchievement(s, owner, id, progressAt)
		log("claim "+id, map[string]any{"err": outcome(err), "reward": claim.Reward, "gold": claim.State.Gold, "cash": claim.State.Cash})
	}
	for _, m := range progress.Missions {
		claim, err := cafe.ClaimMission(s, owner, m.ID, progressAt)
		log("mission "+m.ID, map[string]any{"err": outcome(err), "reward": claim.Reward, "cash": claim.State.Cash})
	}
	progress, err = cafe.SnapshotProgress(s, owner, progressAt)
	if err != nil {
		t.Fatal(err)
	}
	showProgress("progress claimed", progress)
	renamed, err := cafe.RenameCafe(s, owner, "  Café   Paridade ")
	log("rename", map[string]any{"err": outcome(err), "name": renamed.CafeName})
	_, err = cafe.RenameCafe(s, owner, "<script>")
	log("rename invalid", outcome(err))
	snapshot, err := cafe.SnapshotRoom(s, owner)
	log("cafe", map[string]any{"err": outcome(err), "cafe": snapshot.Cafe})

	// Sprint 13: the store. A Grana item, decoration, and a stove bought, stored
	// and bought again on the same tile (the cooking table keeps the stored
	// stove's tile: a unique index there broke the second purchase).
	shop := func(label, action string, itemID int, unitID string, x, y int) cafe.RoomSnapshot {
		current, err := cafe.SnapshotRoom(s, owner)
		if err != nil {
			t.Fatal(err)
		}
		rotation := 0
		command := cafe.RoomCommand{ItemID: itemID, UnitID: unitID, TX: &x, TY: &y, Rotation: &rotation, Revision: &current.Revision, RequestID: "parity-shop-" + label}
		if action == "store" || action == "sell" {
			command = cafe.RoomCommand{UnitID: unitID, Revision: &current.Revision, RequestID: "parity-shop-" + label}
		}
		result, err := cafe.MutateRoom(s, owner, action, command, t0)
		log("shop "+label, map[string]any{"err": outcome(err), "gold": result.PlayerState.Gold, "cash": result.PlayerState.Cash, "decor": result.Decor.BonusTenths, "popularity": result.Cafe.Popularity})
		return result
	}
	shop("gold chair", "purchase", 3040005, "", 4, 4)
	shop("vase", "purchase", 3500000, "", 5, 3)
	shop("locked statue", "purchase", 3500003, "", 4, 6)
	boughtStove := shop("stove", "purchase", 3070000, "", 4, 6)
	stoveUnit := ""
	for _, u := range boughtStove.Inventory {
		if u.ItemID == 3070000 && u.TX == 4 && u.TY == 6 && u.Placed {
			stoveUnit = u.UnitID
		}
	}
	shop("store stove", "store", 0, stoveUnit, 0, 0)
	shop("stove again", "purchase", 3070000, "", 4, 6)
	shop("stored stove back", "move", 0, stoveUnit, 6, 7)
	stoves, err := cafe.SnapshotCooking(s, owner, t0)
	log("stoves", map[string]any{"err": outcome(err), "count": len(stoves.Stoves)})

	// Sprint 14: the pantry and mystery crates (a retried opening answers the same prize).
	spiceBuy, err := cafe.BuySpice(s, owner, 800001, t0)
	log("buy spice", map[string]any{"err": outcome(err), "pantry": spiceBuy.State.Pantry, "gold": spiceBuy.State.Gold})
	for _, key := range []string{"parity-crate-000001", "parity-crate-000001", "parity-crate-000002"} {
		opened, err := cafe.OpenCrate(s, owner, "surprise", key, t0)
		log("open crate", map[string]any{"err": outcome(err), "prize": opened.Prize.Name, "crates": opened.State.Crates, "pantry": opened.State.Pantry, "gold": opened.State.Gold, "cash": opened.State.Cash})
	}
	_, err = cafe.OpenCrate(s, owner, "gold", "parity-crate-000003", t0)
	log("open gold crate", outcome(err))
	pantry, err := cafe.SnapshotPantry(s, owner)
	log("pantry", map[string]any{"err": outcome(err), "free": pantry.FreeCrates, "max": pantry.FreeMax, "spices": len(pantry.Spices)})
	// A pantry spice on a batch: it must be stored on the job (a field the
	// PocketBase schema has to declare) and come back when cancelled in time.
	spiceAt := t0.Add(48 * time.Hour)
	idle, err := cafe.SnapshotCooking(s, owner, spiceAt)
	if err != nil {
		t.Fatal(err)
	}
	for _, stove := range idle.Stoves {
		if stove.Cooking != nil {
			continue
		}
		log("cook to spice", outcome(cafe.StartCooking(s, owner, stove.ID, "pao_de_queijo", spiceAt)))
		log("spice", outcome(cafe.SeasonCooking(s, owner, owner, stove.ID, 800001, spiceAt.Add(time.Second/2))))
		spiced, _ := cafe.SnapshotCooking(s, owner, spiceAt.Add(time.Second))
		for _, view := range spiced.Stoves {
			if view.ID == stove.ID && view.Cooking != nil {
				log("spiced batch", map[string]any{"spice": view.Cooking.Spice, "servings": view.Cooking.Servings})
			}
		}
		_, err := cafe.CancelCooking(s, owner, stove.ID, spiceAt.Add(time.Second))
		after, _ := cafe.SnapshotPantry(s, owner)
		log("cancel spiced", map[string]any{"err": outcome(err), "spices": after.Spices})
		break
	}

	// Sprint 15a: the stove limit, selling stored units, replaced floors kept in
	// the inventory, theme sets and the multi-stove (its extra servings are a
	// stove_cooking column the PocketBase schema has to declare).
	player, err := s.First(cafe.PlayerCollection, cafe.Where{"user": owner})
	if err != nil {
		t.Fatal(err)
	}
	player.Set("gold", 100000)
	player.Set("level", 25)
	player.Set("experience_current", gamerules.Public().Levels[24].RequiredXP)
	player.Set("experience_max", gamerules.Public().Levels[25].RequiredXP)
	if err := s.Save(player); err != nil {
		t.Fatal(err)
	}
	shop("stove over the limit", "purchase", 3070000, "", 8, 8)
	limited := room("equipment")
	log("equipment", limited.Equipment)
	shop("sell placed stove", "sell", 0, stoveUnit, 0, 0)
	shop("store a stove to sell", "store", 0, stoveUnit, 0, 0)
	sold := shop("sell stored stove", "sell", 0, stoveUnit, 0, 0)
	log("sold", map[string]any{"equipment": sold.Equipment, "units": len(sold.Inventory)})
	// The starter stove came with the café (player_inventory.granted, a column
	// the PocketBase schema has to declare): stored, it still has no sale value.
	starterStove := ""
	for _, u := range sold.Inventory {
		if u.ItemID == 3070000 && u.Placed && u.UnitID != stoveUnit {
			if unit, err := s.Get("player_inventory", u.UnitID); err == nil && unit.GetBool("granted") {
				starterStove = u.UnitID
			}
		}
	}
	log("granted starter stove", starterStove != "")
	shop("store the starter stove", "store", 0, starterStove, 0, 0)
	shop("sell the starter stove", "sell", 0, starterStove, 0, 0)
	shop("starter stove back", "move", 0, starterStove, 6, 2)
	shop("sky floor over the old one", "purchase", 3050001, "", 2, 2)
	for i, item := range []int{3500006, 3500007, 3500005} {
		shop(fmt.Sprintf("japan piece %d", i), "purchase", item, "", 8, 2+2*i)
	}
	themed := room("themes")
	log("decor sets", map[string]any{"sets": themed.Decor.Sets, "setTenths": themed.Decor.SetTenths, "bonus": themed.Decor.BonusTenths, "max": themed.Decor.MaxTenths})
	multi := shop("multi-stove", "purchase", 3070005, "", 6, 7)
	multiAt := t0.Add(72 * time.Hour)
	for _, u := range multi.Inventory {
		if u.ItemID == 3070005 && u.Placed {
			log("cook on the multi-stove", outcome(cafe.StartCooking(s, owner, u.StoveID, "coxinha", multiAt)))
		}
	}
	cooking("multi-stove batch", multiAt.Add(time.Second))

	// Sprint 15b: energy (energy_at), pantry consumables and the spice shelf,
	// drink machines and an entertainment machine (room_machines), read back.
	at := t0.Add(96 * time.Hour)
	machineLog := func(views []cafe.MachineView) []string {
		lines := []string{}
		for _, v := range views {
			lines = append(lines, fmt.Sprintf("%d L%d/%d %s parts=%d/%d next=%d runs=%d pay=%d+%dxp patience=%d%% on=%s ready=%s",
				v.ItemID, v.Level, v.MaxLevel, v.State, v.Parts, v.PartsNeeded, v.NextCoins, v.Runs, v.RunCoins, v.RunXP, v.PatiencePercent, offset(v.ActivatedAt), offset(v.ReadyAt)))
		}
		return lines
	}
	for _, code := range []int{810001, 810002, 820001, 820001, 820001} {
		bought, err := cafe.BuySpice(s, owner, code, at)
		log(fmt.Sprintf("buy %d", code), map[string]any{"err": outcome(err), "pantry": bought.State.Pantry, "gold": bought.State.Gold, "cash": bought.State.Cash})
	}
	shelfRoom := shop("spice shelf", "purchase", 3500012, "", 2, 8)
	log("shelf", len(shelfRoom.Inventory))
	machineRoom := shop("coffee machine", "purchase", 3700000, "", 4, 8)
	jukeboxRoom := shop("jukebox", "purchase", 3700002, "", 8, 8)
	for _, u := range machineRoom.Inventory {
		if u.ItemID == 3700000 && u.Placed {
			log("brew", outcome(cafe.StartCooking(s, owner, u.StoveID, "cafe_expresso", at)))
			espresso, _ := gamerules.RecipeByID("cafe_expresso")
			ready := at.Add(gamerules.PrepareDuration() + espresso.CookDuration())
			log("brew served", outcome(cafe.ServeCooking(s, owner, u.StoveID, ready)))
		}
	}
	energy, err := s.First(cafe.PlayerCollection, cafe.Where{"user": owner})
	if err != nil {
		t.Fatal(err)
	}
	log("energy after the coffee", map[string]any{"current": energy.GetInt("energy_current"), "at": offset(energy.GetTime("energy_at").UTC().Format(cafe.TimeLayout))})
	used, err := cafe.UseConsumable(s, owner, 810001, at.Add(time.Hour))
	log("energy drink", map[string]any{"err": outcome(err), "energy": used.State.Energy, "at": offset(used.State.EnergyAt), "pantry": used.State.Pantry})
	for _, u := range jukeboxRoom.Inventory {
		if u.ItemID != 3700002 || !u.Placed {
			continue
		}
		for i := 0; i < 3; i++ {
			result, err := cafe.OperateMachine(s, owner, "machine_install", u.UnitID, at.Add(time.Hour))
			log("install part", map[string]any{"err": outcome(err), "machines": machineLog(result.Machines)})
		}
		started, err := cafe.OperateMachine(s, owner, "machine_start", u.UnitID, at.Add(time.Hour))
		log("jukebox on", map[string]any{"err": outcome(err), "machines": machineLog(started.Machines), "energy": started.State.Energy})
		collected, err := cafe.OperateMachine(s, owner, "machine_collect", u.UnitID, at.Add(time.Hour+gamerules.EntertainmentRun()))
		log("jukebox collected", map[string]any{"err": outcome(err), "coins": collected.Coins, "xp": collected.XP, "machines": machineLog(collected.Machines)})
	}
	machinesNow, err := cafe.SnapshotMachines(s, owner, at.Add(2*time.Hour))
	log("machines", map[string]any{"err": outcome(err), "machines": machineLog(machinesNow)})
	machineWorld, err := cafe.PublicWorld(s, owner, at.Add(2*time.Hour))
	log("world machines", map[string]any{"err": outcome(err), "machines": len(machineWorld.Machines)})
	harvested, err := cafe.HarvestFarm(s, owner, at.Add(3*time.Hour))
	log("shelf harvest", map[string]any{"err": outcome(err), "spice": harvested.FreeSpice})
	shelfPantry, err := cafe.SnapshotPantry(s, owner)
	log("pantry with a shelf", map[string]any{"err": outcome(err), "limit": shelfPantry.SpiceLimit, "shelf": shelfPantry.Shelf, "items": shelfPantry.Items})

	// Sprint 16: the tip jar (player_rooms.tip_jar, filled by the payments
	// above), the legacy granted marking, a spoiled dish rescued with the
	// Sálvia Salvadora and a batch accelerated with energy.
	late := t0.Add(100 * time.Hour)
	jarRoom := room("tip jar room")
	log("tip jar", jarRoom.TipJar)
	tips, err := cafe.CollectTips(s, owner, late)
	log("collect tips", map[string]any{"err": outcome(err), "coins": tips.Coins, "jar": tips.Jar, "gold": tips.State.Gold})
	_, err = cafe.CollectTips(s, owner, late)
	log("collect an empty jar", outcome(err))
	inventory, err := s.Find("player_inventory", cafe.Query{Where: cafe.Where{"user": owner}, Limit: 10000})
	if err != nil {
		t.Fatal(err)
	}
	for _, unit := range inventory {
		unit.Set("granted", false)
		if err := s.Save(unit); err != nil {
			t.Fatal(err)
		}
	}
	marked, err := cafe.MarkLegacyGranted(s, owner)
	log("legacy granted", map[string]any{"err": outcome(err), "marked": marked})
	again, err := cafe.MarkLegacyGranted(s, owner)
	log("legacy granted again", map[string]any{"err": outcome(err), "marked": again})
	salvia, err := cafe.BuySpice(s, owner, 800003, late)
	log("buy salvia", map[string]any{"err": outcome(err), "pantry": salvia.State.Pantry})
	cooking("spoiled multi-stove", late)
	for _, stove := range func() []cafe.StoveView { c, _ := cafe.SnapshotCooking(s, owner, late); return c.Stoves }() {
		if stove.ItemID != 3070005 || stove.Cooking == nil {
			continue
		}
		log("rescue", outcome(cafe.RescueCooking(s, owner, stove.ID, 800003, late)))
		cooking("rescued", late)
		log("serve rescued", outcome(cafe.ServeCooking(s, owner, stove.ID, late.Add(time.Second))))
		log("cook to boost", outcome(cafe.StartCooking(s, owner, stove.ID, "coxinha", late.Add(time.Minute))))
		boostAt := late.Add(time.Minute + gamerules.PrepareDuration() + 10*time.Second)
		log("boost", outcome(cafe.BoostCooking(s, owner, stove.ID, boostAt)))
		cooking("boosted", boostAt)
		boosted, _ := s.First(cafe.PlayerCollection, cafe.Where{"user": owner})
		log("energy after the boost", map[string]any{"current": boosted.GetInt("energy_current"), "at": offset(boosted.GetTime("energy_at").UTC().Format(cafe.TimeLayout))})
	}
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

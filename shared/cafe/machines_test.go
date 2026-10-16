package cafe

import (
	"errors"
	"testing"
	"time"

	"coffe-mania/shared/gamerules"
)

func levelUp(t *testing.T, s Store, owner string, level int, fields map[string]any) {
	t.Helper()
	all := map[string]any{"level": level, "experience_current": gamerules.Public().Levels[level-1].RequiredXP}
	for key, value := range fields {
		all[key] = value
	}
	setPlayer(t, s, owner, all)
}

func TestEnergyRegeneratesFromTheStoredInstant(t *testing.T) {
	s, _ := newCafe(t, "owner")
	rules := gamerules.Energy()
	state, _ := GetOrCreatePlayer(s, "owner")
	if err := SpendEnergy(state, rules.Max+1, progressT0); !errors.Is(err, ErrEnergy) {
		t.Fatalf("spending more than the bar: %v", err)
	}
	if err := SpendEnergy(state, 10, progressT0); err != nil {
		t.Fatal(err)
	}
	if got, _ := energyNow(state, progressT0); got != rules.Max-10 {
		t.Fatalf("after spending 10: %d", got)
	}
	regen := gamerules.EnergyRegen()
	// Three points and a half later: three back, the half kept for the next one.
	at := progressT0.Add(3*regen + regen/2)
	if got, _ := energyNow(state, at); got != rules.Max-7 {
		t.Fatalf("after 3.5 regen periods: %d", got)
	}
	if err := SpendEnergy(state, 1, at); err != nil {
		t.Fatal(err)
	}
	if got, _ := energyNow(state, progressT0.Add(4*regen)); got != rules.Max-7 {
		t.Fatalf("the half point was lost: %d", got)
	}
	// A long absence refills the bar but never above it.
	if got, _ := energyNow(state, progressT0.Add(24*time.Hour)); got != rules.Max {
		t.Fatalf("after a day away: %d", got)
	}
	// Drinks go above the bar, up to the cap, and the bar does not regenerate meanwhile.
	AddEnergy(state, rules.Cap, progressT0.Add(24*time.Hour))
	if got, _ := energyNow(state, progressT0.Add(48*time.Hour)); got != rules.Cap {
		t.Fatalf("above the bar: %d", got)
	}
}

func TestPantryConsumablesAndTheSpiceShelf(t *testing.T) {
	s, _ := newCafe(t, "owner")
	levelUp(t, s, "owner", 10, map[string]any{"gold": 100000, "cash": 3})
	turbo, _ := gamerules.ConsumableByCode(810001)
	part, _ := gamerules.ConsumableByCode(MachinePartCode)
	bought, err := BuySpice(s, "owner", turbo.Code, progressT0)
	if err != nil || bought.State.Gold != 100000-turbo.PriceCoins || bought.State.Pantry["810001"] != 1 {
		t.Fatalf("buy energy drink: %+v %v", bought.State, err)
	}
	withPart, err := BuySpice(s, "owner", part.Code, progressT0)
	if err != nil || withPart.State.Cash != 3-part.PriceCash || withPart.State.Pantry["820001"] != 1 {
		t.Fatalf("buy a part for Grana: %+v %v", withPart.State, err)
	}
	if _, err := UseConsumable(s, "owner", part.Code, progressT0); !errors.Is(err, ErrPantryUse) {
		t.Fatalf("drinking a part: %v", err)
	}
	state, _ := GetOrCreatePlayer(s, "owner")
	if err := SpendEnergy(state, 20, progressT0); err != nil {
		t.Fatal(err)
	}
	_ = s.Save(state)
	used, err := UseConsumable(s, "owner", turbo.Code, progressT0)
	if err != nil || used.State.Energy.Current != float64(gamerules.Energy().Max-20+turbo.Amount) || used.State.Pantry["810001"] != 0 {
		t.Fatalf("drink: %+v %v", used.State, err)
	}
	if _, err := UseConsumable(s, "owner", turbo.Code, progressT0); !errors.Is(err, ErrPantryEmpty) {
		t.Fatalf("drinking from an empty pantry: %v", err)
	}
	// Without a shelf the pantry holds SpiceLimit charges of each spice; with one, more.
	limits := gamerules.Pantry()
	for range limits.SpiceLimit {
		if _, err := BuySpice(s, "owner", 800001, progressT0); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := BuySpice(s, "owner", 800001, progressT0); !errors.Is(err, ErrSpiceFull) {
		t.Fatalf("over the limit without a shelf: %v", err)
	}
	if _, err := buy(t, s, "owner", catalogItem(t, "spice_shelf").ID, 4, 4); err != nil {
		t.Fatal(err)
	}
	full, err := BuySpice(s, "owner", 800001, progressT0)
	if err != nil || full.Pantry.SpiceLimit != limits.ShelfSpiceLimit || !full.Pantry.Shelf {
		t.Fatalf("with a shelf: %+v %v", full.Pantry, err)
	}
}

func TestTheShelfMayGiveASpiceWithTheHarvest(t *testing.T) {
	s, _ := newCafe(t, "owner")
	levelUp(t, s, "owner", 10, map[string]any{"gold": 10000})
	fixedDraws(t, 0, 0)
	if state, err := HarvestFarm(s, "owner", progressT0); err != nil || state.FreeSpice != 0 {
		t.Fatalf("no shelf, no spice: %+v %v", state, err)
	}
	if _, err := buy(t, s, "owner", catalogItem(t, "spice_shelf").ID, 4, 4); err != nil {
		t.Fatal(err)
	}
	room, _ := s.First("player_rooms", Where{"user": "owner"})
	room.Set("fresh_charges", 0)
	_ = s.Save(room)
	// The chance draw lands under the percentage, then the first spice is drawn.
	fixedDraws(t, 0, 0)
	state, err := HarvestFarm(s, "owner", progressT0.Add(time.Duration(gamerules.Street().Farm.CooldownSeconds)*time.Second))
	if err != nil || state.FreeSpice != gamerules.Spices()[0].Code || pantryOf(t, s, "owner")[state.FreeSpice] != 1 {
		t.Fatalf("shelf harvest: %+v %v", state, err)
	}
}

func TestDrinkMachinesMakeDrinksWithEnergy(t *testing.T) {
	s, stove := newCafe(t, "owner")
	levelUp(t, s, "owner", 12, map[string]any{"gold": 100000})
	machine := catalogItem(t, "coffee_machine")
	bought, err := buy(t, s, "owner", machine.ID, 4, 4)
	if err != nil {
		t.Fatal(err)
	}
	unit := unitOf(bought, machine.ID, true)
	if unit.StoveID == "" {
		t.Fatal("a drink machine has no cooking row")
	}
	espresso, _ := gamerules.RecipeByID("cafe_expresso")
	juice, _ := gamerules.RecipeByID("suco_laranja")
	if err := StartCooking(s, "owner", unit.StoveID, juice.ID, progressT0); !errors.Is(err, ErrWrongAppliance) {
		t.Fatalf("juice on the coffee machine: %v", err)
	}
	if err := StartCooking(s, "owner", unit.StoveID, "pao_de_queijo", progressT0); !errors.Is(err, ErrWrongAppliance) {
		t.Fatalf("a dish on the machine: %v", err)
	}
	if err := StartCooking(s, "owner", stove, espresso.ID, progressT0); !errors.Is(err, ErrWrongAppliance) {
		t.Fatalf("coffee on a stove: %v", err)
	}
	setPlayer(t, s, "owner", map[string]any{"energy_current": espresso.Energy - 1, "energy_at": progressT0})
	if err := StartCooking(s, "owner", unit.StoveID, espresso.ID, progressT0); !errors.Is(err, ErrEnergy) {
		t.Fatalf("without energy: %v", err)
	}
	setPlayer(t, s, "owner", map[string]any{"energy_current": 20})
	if err := StartCooking(s, "owner", unit.StoveID, espresso.ID, progressT0); err != nil {
		t.Fatal(err)
	}
	state, _ := GetOrCreatePlayer(s, "owner")
	if got, _ := energyNow(state, progressT0); got != 20-espresso.Energy || state.GetInt64("gold") != 100000-machine.PriceGold-espresso.CostCoins {
		t.Fatalf("energy %d, gold %d", got, state.GetInt64("gold"))
	}
	if err := SeasonCooking(s, "owner", "owner", unit.StoveID, 0, progressT0.Add(time.Second)); !errors.Is(err, ErrDrinkSeason) {
		t.Fatalf("seasoning a drink: %v", err)
	}
	ready := progressT0.Add(gamerules.PrepareDuration() + espresso.CookDuration())
	if err := ServeCooking(s, "owner", unit.StoveID, ready); err != nil {
		t.Fatal(err)
	}
	food, err := s.First("room_food", Where{"user": "owner"})
	if err != nil || food.GetString("counter") != unit.UnitID || food.GetInt("servings") != espresso.Servings {
		t.Fatalf("the drink waits on the machine: %v", err)
	}
	// A second batch of another drink waits for this one to go.
	if err := StartCooking(s, "owner", unit.StoveID, "cappuccino", ready); err != nil {
		t.Fatal(err)
	}
	cappuccino, _ := gamerules.RecipeByID("cappuccino")
	later := ready.Add(gamerules.PrepareDuration() + cappuccino.CookDuration())
	if err := ServeCooking(s, "owner", unit.StoveID, later); !errors.Is(err, ErrMachineFull) {
		t.Fatalf("another drink on a busy machine: %v", err)
	}
	payment, err := ServeServing(s, "owner", food.ID(), "", false, later)
	if err != nil || payment.Coins != espresso.PricePerServing {
		t.Fatalf("a customer pays for the coffee: %+v %v", payment, err)
	}
	if dishes := progressOf(t, s, "owner", later).Today[gamerules.StatDishes]; dishes != 0 {
		t.Fatalf("drinks counted as dishes: %d", dishes)
	}
	// The machine cannot be stored while a batch is on it or a drink waits on it.
	if _, err := roomCommand(t, s, "owner", "store", RoomCommand{UnitID: unit.UnitID}); !errors.Is(err, ErrRoomBusy) {
		t.Fatalf("storing a machine with a batch: %v", err)
	}
	if _, err := CancelCooking(s, "owner", unit.UnitID, later); err == nil {
		t.Fatal("cancelled by unit id")
	}
	if err := CleanStove(s, "owner", unit.StoveID, later.Add(48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := roomCommand(t, s, "owner", "store", RoomCommand{UnitID: unit.UnitID}); !errors.Is(err, ErrCounterBusy) {
		t.Fatalf("storing a machine with drinks: %v", err)
	}
}

func TestEntertainmentMachinesAreBuiltRunAndRepaired(t *testing.T) {
	s, _ := newCafe(t, "owner")
	levelUp(t, s, "owner", 12, map[string]any{"gold": 100000})
	jukebox := catalogItem(t, "jukebox")
	rules, _ := gamerules.EntertainmentFor(jukebox.ID)
	play := gamerules.EntertainmentRulesNow()
	bought, err := buy(t, s, "owner", jukebox.ID, 4, 4)
	if err != nil {
		t.Fatal(err)
	}
	unit := unitOf(bought, jukebox.ID, true).UnitID
	machines, _ := SnapshotMachines(s, "owner", progressT0)
	if len(machines) != 1 || machines[0].State != MachineAssembling || machines[0].PartsNeeded != rules.Levels[0].Parts {
		t.Fatalf("a new jukebox: %+v", machines)
	}
	if _, err := OperateMachine(s, "owner", "machine_start", unit, progressT0); !errors.Is(err, ErrMachineBuilding) {
		t.Fatalf("starting a frame: %v", err)
	}
	if _, err := OperateMachine(s, "owner", "machine_install", unit, progressT0); !errors.Is(err, ErrMachineParts) {
		t.Fatalf("installing without parts: %v", err)
	}
	state, _ := GetOrCreatePlayer(s, "owner")
	addSpices(state, MachinePartCode, rules.Levels[0].Parts+rules.Levels[1].Parts)
	_ = s.Save(state)
	var result MachinesResult
	for i := range rules.Levels[0].Parts {
		if result, err = OperateMachine(s, "owner", "machine_install", unit, progressT0); err != nil {
			t.Fatalf("part %d: %v", i, err)
		}
	}
	if result.Machines[0].Level != 1 || result.Machines[0].State != MachineIdle {
		t.Fatalf("built: %+v", result.Machines[0])
	}
	// The second level's last part needs its coins.
	setPlayer(t, s, "owner", map[string]any{"gold": rules.Levels[1].Coins - 1})
	for i := 0; i < rules.Levels[1].Parts-1; i++ {
		if _, err := OperateMachine(s, "owner", "machine_install", unit, progressT0); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := OperateMachine(s, "owner", "machine_install", unit, progressT0); !errors.Is(err, ErrMachineCoins) {
		t.Fatalf("upgrade without coins: %v", err)
	}
	if pantryOf(t, s, "owner")[MachinePartCode] != 1 {
		t.Fatal("a refused part was used up")
	}
	setPlayer(t, s, "owner", map[string]any{"gold": rules.Levels[1].Coins})
	if result, err = OperateMachine(s, "owner", "machine_install", unit, progressT0); err != nil || result.Machines[0].Level != 2 || result.State.Gold != 0 {
		t.Fatalf("upgrade: %+v %v", result, err)
	}
	// Runs: energy to switch on, pay on collect, broken after the maintenance runs.
	at := progressT0
	for run := 1; run <= play.MaintenanceRuns; run++ {
		setPlayer(t, s, "owner", map[string]any{"energy_current": play.StartEnergy, "energy_at": at})
		if result, err = OperateMachine(s, "owner", "machine_start", unit, at); err != nil || result.Machines[0].State != MachineRunning {
			t.Fatalf("run %d start: %+v %v", run, result, err)
		}
		if _, err := roomCommand(t, s, "owner", "store", RoomCommand{UnitID: unit}); !errors.Is(err, ErrMachineRunning) {
			t.Fatalf("storing a running machine: %v", err)
		}
		if _, err := OperateMachine(s, "owner", "machine_collect", unit, at.Add(time.Minute)); !errors.Is(err, ErrMachineNotReady) {
			t.Fatalf("collecting early: %v", err)
		}
		at = at.Add(gamerules.EntertainmentRun())
		before, _ := GetOrCreatePlayer(s, "owner")
		if result, err = OperateMachine(s, "owner", "machine_collect", unit, at); err != nil || result.Coins != rules.Levels[1].RunCoins ||
			result.State.Gold < before.GetInt64("gold")+rules.Levels[1].RunCoins {
			t.Fatalf("run %d collect: %+v %v", run, result, err)
		}
	}
	if result.Machines[0].State != MachineBroken {
		t.Fatalf("after %d runs: %+v", play.MaintenanceRuns, result.Machines[0])
	}
	if _, err := OperateMachine(s, "owner", "machine_start", unit, at); !errors.Is(err, ErrMachineBroken) {
		t.Fatalf("starting a broken machine: %v", err)
	}
	setPlayer(t, s, "owner", map[string]any{"energy_current": play.RepairEnergy, "energy_at": at})
	if result, err = OperateMachine(s, "owner", "machine_repair", unit, at); err != nil || result.Machines[0].State != MachineIdle || result.Machines[0].Runs != 0 {
		t.Fatalf("repair: %+v %v", result, err)
	}
	// Selling the stored machine removes its row.
	if _, err := roomCommand(t, s, "owner", "store", RoomCommand{UnitID: unit}); err != nil {
		t.Fatal(err)
	}
	if _, err := roomCommand(t, s, "owner", "sell", RoomCommand{UnitID: unit}); err != nil {
		t.Fatal(err)
	}
	if machines, _ := SnapshotMachines(s, "owner", at); len(machines) != 0 {
		t.Fatalf("machines after the sale: %+v", machines)
	}
}

func TestARunningMachineReachesTheWorld(t *testing.T) {
	s, _ := newCafe(t, "owner")
	levelUp(t, s, "owner", 12, map[string]any{"gold": 100000})
	jukebox := catalogItem(t, "jukebox")
	rules, _ := gamerules.EntertainmentFor(jukebox.ID)
	bought, _ := buy(t, s, "owner", jukebox.ID, 4, 4)
	unit := unitOf(bought, jukebox.ID, true).UnitID
	state, _ := GetOrCreatePlayer(s, "owner")
	addSpices(state, MachinePartCode, rules.Levels[0].Parts)
	_ = s.Save(state)
	for range rules.Levels[0].Parts {
		if _, err := OperateMachine(s, "owner", "machine_install", unit, progressT0); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := OperateMachine(s, "owner", "machine_start", unit, progressT0); err != nil {
		t.Fatal(err)
	}
	world, err := PublicWorld(s, "owner", progressT0.Add(time.Minute))
	if err != nil || len(world.Machines) != 1 || world.Machines[0].State != MachineRunning || world.Machines[0].PatiencePercent != rules.Levels[0].PatiencePercent ||
		world.Machines[0].RunUntil != progressT0.Add(gamerules.EntertainmentRun()).UnixMilli() {
		t.Fatalf("world machines: %+v %v", world.Machines, err)
	}
}

func TestTheMissionTrioGivesAnEnergyDrink(t *testing.T) {
	s, _ := newCafe(t, "owner")
	missions := DailyMissions("owner", bonusDate(progressT0))
	if err := s.Transaction(func(tx Store) error {
		for _, m := range missions {
			if err := count(tx, "owner", progressT0, m.Goals[0].Stat, m.Goals[0].Target); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var last ProgressClaim
	for _, m := range missions {
		claim, err := ClaimMission(s, "owner", m.ID, progressT0)
		if err != nil {
			t.Fatal(err)
		}
		last = claim
	}
	stock := gamerules.MissionTrioStock()
	if len(stock) == 0 || len(last.Stock) != len(stock) || last.State.Pantry["810001"] != stock[0].Count {
		t.Fatalf("trio stock: %+v pantry %v", last.Stock, last.State.Pantry)
	}
}

func TestAStoredMachineDoesNotPlay(t *testing.T) {
	s, _ := newCafe(t, "owner")
	levelUp(t, s, "owner", 12, map[string]any{"gold": 100000})
	jukebox := catalogItem(t, "jukebox")
	rules, _ := gamerules.EntertainmentFor(jukebox.ID)
	bought, err := buy(t, s, "owner", jukebox.ID, 4, 4)
	if err != nil {
		t.Fatal(err)
	}
	unit := unitOf(bought, jukebox.ID, true).UnitID
	state, _ := GetOrCreatePlayer(s, "owner")
	addSpices(state, MachinePartCode, rules.Levels[0].Parts)
	_ = s.Save(state)
	for range rules.Levels[0].Parts {
		if _, err := OperateMachine(s, "owner", "machine_install", unit, progressT0); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := roomCommand(t, s, "owner", "store", RoomCommand{UnitID: unit}); err != nil {
		t.Fatal(err)
	}
	if _, err := OperateMachine(s, "owner", "machine_start", unit, progressT0); !errors.Is(err, ErrMachineStored) {
		t.Fatalf("starting a stored machine: %v", err)
	}
	if status, _ := ErrorStatus(ErrMachineStored); status != 409 {
		t.Fatalf("status of a stored machine: %d", status)
	}
}

func TestEnergyDrinksStopAtTheCapAndOldRowsCountAsFull(t *testing.T) {
	s, _ := newCafe(t, "owner")
	rules := gamerules.Energy()
	setPlayer(t, s, "owner", map[string]any{"energy_current": rules.Cap, "energy_at": progressT0})
	state, _ := GetOrCreatePlayer(s, "owner")
	addSpices(state, 810001, 1)
	_ = s.Save(state)
	if _, err := UseConsumable(s, "owner", 810001, progressT0); !errors.Is(err, ErrEnergyFull) {
		t.Fatalf("a drink at the cap: %v", err)
	}
	if status, _ := PantryErrorStatus(ErrEnergyFull); status != 409 {
		t.Fatalf("status at the cap: %d", status)
	}
	// The drink stays in the pantry.
	pantry, _ := SnapshotPantry(s, "owner")
	kept := 0
	for _, item := range pantry.Items {
		if item.Code == 810001 {
			kept = item.Count
		}
	}
	if kept != 1 {
		t.Fatalf("the refused drink was spent: %d left", kept)
	}
	// A row from before energy_at (fixed 50/50 bar, or lower) counts as full.
	setPlayer(t, s, "owner", map[string]any{"energy_current": 10, "energy_at": ""})
	state, _ = GetOrCreatePlayer(s, "owner")
	limit := state.GetInt("energy_max")
	if limit < 1 {
		limit = rules.Max
	}
	if got, _ := energyNow(state, progressT0); got != limit {
		t.Fatalf("an old row without energy_at: %d", got)
	}
}

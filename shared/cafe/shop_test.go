package cafe

import (
	"errors"
	"testing"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/roomcatalog"
)

func buy(t *testing.T, s Store, owner string, itemID, x, y int) (RoomSnapshot, error) {
	t.Helper()
	room, err := s.First("player_rooms", Where{"user": owner})
	if err != nil {
		t.Fatal(err)
	}
	revision, rotation := room.GetInt("revision"), 0
	return MutateRoom(s, owner, "purchase", RoomCommand{ItemID: itemID, TX: &x, TY: &y, Rotation: &rotation, Revision: &revision,
		RequestID: "shop-test-" + time.Now().Format("150405.000000000")}, progressT0)
}

func setPlayer(t *testing.T, s Store, owner string, fields map[string]any) {
	t.Helper()
	state, _ := GetOrCreatePlayer(s, owner)
	setAll(state, fields)
	if err := s.Save(state); err != nil {
		t.Fatal(err)
	}
}

func catalogItem(t *testing.T, classname string) roomcatalog.Item {
	t.Helper()
	for _, item := range roomcatalog.Items {
		if item.Classname == classname {
			return item
		}
	}
	t.Fatalf("no item %s", classname)
	return roomcatalog.Item{}
}

func TestPurchaseChecksLevelAndCurrency(t *testing.T) {
	s, _ := newCafe(t, "owner")
	table := catalogItem(t, "blue_cloth_table")
	setPlayer(t, s, "owner", map[string]any{"gold": 10000, "level": table.MinLevel() - 1})
	if _, err := buy(t, s, "owner", table.ID, 4, 4); !errors.Is(err, ErrRoomLevel) {
		t.Fatalf("locked item: %v", err)
	}
	setPlayer(t, s, "owner", map[string]any{"level": table.MinLevel(), "experience_current": gamerules.Public().Levels[table.MinLevel()-1].RequiredXP})
	snapshot, err := buy(t, s, "owner", table.ID, 4, 4)
	if err != nil || snapshot.PlayerState.Gold != 10000-table.PriceGold {
		t.Fatalf("buy: gold %d, %v", snapshot.PlayerState.Gold, err)
	}
	// Grana items cost Grana only and do not count as coins spent.
	chair := catalogItem(t, "gold_chair")
	if !chair.PaidWithCash() || chair.PriceGold != 0 {
		t.Fatalf("gold chair is not a Grana item: %+v", chair)
	}
	setPlayer(t, s, "owner", map[string]any{"cash": chair.PriceCash - 1})
	if _, err := buy(t, s, "owner", chair.ID, 5, 3); !errors.Is(err, ErrRoomCash) {
		t.Fatalf("not enough Grana: %v", err)
	}
	setPlayer(t, s, "owner", map[string]any{"cash": chair.PriceCash})
	snapshot, err = buy(t, s, "owner", chair.ID, 5, 3)
	if err != nil || snapshot.PlayerState.Cash != 0 || snapshot.PlayerState.Gold != 10000-table.PriceGold {
		t.Fatalf("Grana purchase: %+v %v", snapshot.PlayerState, err)
	}
	if a := achievement(t, progressOf(t, s, "owner", progressT0), "spent_coins"); a.Progress != table.PriceGold {
		t.Fatalf("spent coins = %d, want %d", a.Progress, table.PriceGold)
	}
}

func TestBoughtStovesCookAtTheirSpeed(t *testing.T) {
	s, _ := newCafe(t, "owner")
	setPlayer(t, s, "owner", map[string]any{"gold": 100000, "level": 30, "experience_current": gamerules.Public().Levels[29].RequiredXP})
	setRoomTiles(t, s, "owner", 10) // three stoves: the 10×10 limit
	steel, master := catalogItem(t, "steel_stove"), catalogItem(t, "master_stove")
	if _, err := buy(t, s, "owner", steel.ID, 4, 4); err != nil {
		t.Fatal(err)
	}
	if _, err := buy(t, s, "owner", master.ID, 4, 6); err != nil {
		t.Fatal(err)
	}
	cooking, err := SnapshotCooking(s, "owner", progressT0)
	if err != nil || len(cooking.Stoves) != 3 {
		t.Fatalf("stoves after buying two: %+v %v", cooking.Stoves, err)
	}
	pao, _ := gamerules.RecipeByID("lasanha")
	for _, stove := range cooking.Stoves {
		if err := StartCooking(s, "owner", stove.ID, pao.ID, progressT0); err != nil {
			t.Fatalf("cook on %d: %v", stove.ItemID, err)
		}
		job, _ := s.First("stove_cooking", Where{"stove": stove.ID})
		model, _ := roomcatalog.ByID(stove.ItemID)
		cook := job.GetTime("ready_at").Sub(job.GetTime("started_at"))
		spoil := job.GetTime("spoils_at").Sub(job.GetTime("ready_at"))
		wantCook := pao.CookDuration() * time.Duration(100-model.CookSpeedPercent) / 100
		wantSpoil := pao.SpoilDuration() * time.Duration(100+model.SpoilBonusPercent) / 100
		if cook != wantCook || spoil != wantSpoil {
			t.Fatalf("%s: cook %v spoil %v, want %v and %v", model.Name, cook, spoil, wantCook, wantSpoil)
		}
	}
	if steel.CookSpeedPercent != 15 || master.CookSpeedPercent != 25 || master.SpoilBonusPercent != 50 {
		t.Fatalf("stove speeds changed: %+v %+v", steel, master)
	}
}

func TestCashRegisterMakesSelfServiceTip(t *testing.T) {
	s, stove := newCafe(t, "owner")
	setPlayer(t, s, "owner", map[string]any{"gold": 100000, "level": 10, "experience_current": gamerules.Public().Levels[9].RequiredXP})
	serve := func() int64 {
		pao, _ := gamerules.RecipeByID("pao_de_queijo")
		at := progressT0.Add(time.Duration(len(t.Name())) * time.Hour)
		if err := StartCooking(s, "owner", stove, pao.ID, at); err != nil {
			t.Fatal(err)
		}
		if err := ServeCooking(s, "owner", stove, at.Add(gamerules.PrepareDuration()+pao.CookDuration())); err != nil {
			t.Fatal(err)
		}
		food, err := s.First("room_food", Where{"user": "owner"})
		if err != nil {
			t.Fatal(err)
		}
		payment, err := ServeServing(s, "owner", food.ID(), "", false, at.Add(time.Hour))
		if err != nil {
			t.Fatal(err)
		}
		for {
			rest, err := s.First("room_food", Where{"user": "owner"})
			if err != nil {
				break
			}
			_ = s.Delete(rest)
		}
		return payment.Tip
	}
	if tip := serve(); tip != 0 {
		t.Fatalf("self-service tipped %d without a register", tip)
	}
	if _, err := buy(t, s, "owner", catalogItem(t, "cash_register").ID, 4, 4); err != nil {
		t.Fatal(err)
	}
	if tip := serve(); tip < 1 {
		t.Fatalf("self-service tip with a register = %d", tip)
	}
	if today := progressOf(t, s, "owner", progressT0.Add(25*time.Hour)).Today; today[gamerules.StatTips] < 0 {
		t.Fatalf("today = %v", today)
	}
}

func TestDecorBonusRewardsVariety(t *testing.T) {
	vase := catalogItem(t, "flower_vase")
	rules := gamerules.Decor()
	ids := []int{}
	for range 10 {
		ids = append(ids, vase.ID)
	}
	same := gamerules.DecorBonus(ids)
	want := rules.FullCopies*vase.Charm + rules.HalfCopies*vase.Charm/2
	if same.RawTenths != want || len(same.Lines) != 1 || same.Lines[0].Copies != 10 {
		t.Fatalf("ten vases = %+v, want %d tenths", same, want)
	}
	varied := gamerules.DecorBonus([]int{vase.ID, catalogItem(t, "fern_pot").ID, catalogItem(t, "floor_lamp").ID, catalogItem(t, "chef_statue").ID})
	if varied.RawTenths <= vase.Charm*3 {
		t.Fatalf("four different items (%d) should beat three vases", varied.RawTenths)
	}
	// The whole bonus is capped.
	many := []int{}
	for _, item := range roomcatalog.Items {
		for range 6 {
			many = append(many, item.ID)
		}
	}
	// The items' charm is capped; theme sets pay on top of it, up to their last tier.
	if capped := gamerules.DecorBonus(many); capped.BonusTenths != rules.MaxBonusTenths+capped.SetTenths || capped.RawTenths <= rules.MaxBonusTenths ||
		capped.BonusTenths != capped.MaxTenths {
		t.Fatalf("cap: %+v", capped)
	}
	if got := gamerules.EffectivePopularity(1040, 50); got != 1050 {
		t.Fatalf("effective popularity above the maximum: %d", got)
	}
}

func TestRoomSnapshotCarriesTheDecorBonus(t *testing.T) {
	s, _ := newCafe(t, "owner")
	before, err := SnapshotRoom(s, "owner")
	if err != nil {
		t.Fatal(err)
	}
	setPlayer(t, s, "owner", map[string]any{"gold": 1000, "level": 5, "experience_current": gamerules.Public().Levels[4].RequiredXP})
	vase := catalogItem(t, "flower_vase")
	after, err := buy(t, s, "owner", vase.ID, 4, 4)
	if err != nil {
		t.Fatal(err)
	}
	if after.Decor.BonusTenths != before.Decor.BonusTenths+vase.Charm {
		t.Fatalf("decor %d → %d, want +%d", before.Decor.BonusTenths, after.Decor.BonusTenths, vase.Charm)
	}
	service := float64(after.PlayerState.Satisfaction.Current)
	if got := after.Cafe.Popularity; got != service+float64(after.Decor.BonusTenths)/10 {
		t.Fatalf("visitors see %v, want service %v + decor", got, service)
	}
}

func setRoomTiles(t *testing.T, s Store, owner string, tiles int) {
	t.Helper()
	room, err := s.First("player_rooms", Where{"user": owner})
	if err != nil {
		t.Fatal(err)
	}
	room.Set("tiles_x", tiles)
	room.Set("tiles_y", tiles)
	if err := s.Save(room); err != nil {
		t.Fatal(err)
	}
}

func TestThemeSetsPayForDistinctPieces(t *testing.T) {
	tiers := gamerules.Decor().Sets.Tiers
	japan := []int{}
	for _, item := range roomcatalog.Items {
		if item.Theme == "japan" {
			japan = append(japan, item.ID)
		}
	}
	if len(japan) < tiers[len(tiers)-1].Pieces {
		t.Fatalf("the Japan set has %d pieces, fewer than its last tier", len(japan))
	}
	set := func(ids []int) gamerules.DecorSet {
		for _, s := range gamerules.DecorBonus(ids).Sets {
			if s.Theme == "japan" {
				return s
			}
		}
		return gamerules.DecorSet{}
	}
	if got := set(japan[:tiers[0].Pieces-1]); got.Tenths != 0 || got.Next != tiers[0].Pieces {
		t.Fatalf("below the first tier: %+v", got)
	}
	// Copies of one piece do not count twice.
	repeated := append([]int{}, japan[:tiers[0].Pieces-1]...)
	repeated = append(repeated, japan[0], japan[0])
	if got := set(repeated); got.Tenths != 0 {
		t.Fatalf("repeated pieces made a set: %+v", got)
	}
	if got := set(japan[:tiers[0].Pieces]); got.Tenths != tiers[0].Tenths || got.Next != tiers[1].Pieces {
		t.Fatalf("first tier: %+v", got)
	}
	if got := set(japan[:tiers[1].Pieces]); got.Tenths != tiers[1].Tenths || got.Next != 0 {
		t.Fatalf("last tier: %+v", got)
	}
}

func roomCommand(t *testing.T, s Store, owner, action string, command RoomCommand) (RoomSnapshot, error) {
	t.Helper()
	room, err := s.First("player_rooms", Where{"user": owner})
	if err != nil {
		t.Fatal(err)
	}
	revision := room.GetInt("revision")
	command.Revision = &revision
	command.RequestID = "shop-test-" + action + "-" + time.Now().Format("150405.000000000")
	return MutateRoom(s, owner, action, command, progressT0)
}

func unitOf(snapshot RoomSnapshot, itemID int, placed bool) RoomUnit {
	for _, u := range snapshot.Inventory {
		if u.ItemID == itemID && u.Placed == placed {
			return u
		}
	}
	return RoomUnit{}
}

func TestSellingStoredUnits(t *testing.T) {
	s, _ := newCafe(t, "owner")
	setPlayer(t, s, "owner", map[string]any{"gold": 1000, "cash": 10, "level": 10, "experience_current": gamerules.Public().Levels[9].RequiredXP})
	vase := catalogItem(t, "flower_vase")
	bought, err := buy(t, s, "owner", vase.ID, 4, 4)
	if err != nil {
		t.Fatal(err)
	}
	placed := unitOf(bought, vase.ID, true)
	if _, err := roomCommand(t, s, "owner", "sell", RoomCommand{UnitID: placed.UnitID}); !errors.Is(err, ErrSellPlaced) {
		t.Fatalf("selling a placed unit: %v", err)
	}
	if _, err := roomCommand(t, s, "owner", "store", RoomCommand{UnitID: placed.UnitID}); err != nil {
		t.Fatal(err)
	}
	before, _ := GetOrCreatePlayer(s, "owner")
	sold, err := roomCommand(t, s, "owner", "sell", RoomCommand{UnitID: placed.UnitID})
	if err != nil || sold.PlayerState.Gold != before.GetInt64("gold")+gamerules.SellValue(vase) || unitOf(sold, vase.ID, false).UnitID != "" {
		t.Fatalf("sell: gold %v, %v", sold.PlayerState.Gold, err)
	}
	if gamerules.SellValue(vase) != vase.PriceGold/2 {
		t.Fatalf("sell value %d for a %d-coin item", gamerules.SellValue(vase), vase.PriceGold)
	}
	if _, err := roomCommand(t, s, "owner", "sell", RoomCommand{UnitID: placed.UnitID}); !errors.Is(err, ErrRoomOwned) {
		t.Fatalf("selling twice: %v", err)
	}
	// Grana items have no coin value.
	chair := catalogItem(t, "gold_chair")
	withChair, err := buy(t, s, "owner", chair.ID, 5, 3)
	if err != nil {
		t.Fatal(err)
	}
	chairUnit := unitOf(withChair, chair.ID, true)
	if _, err := roomCommand(t, s, "owner", "store", RoomCommand{UnitID: chairUnit.UnitID}); err != nil {
		t.Fatal(err)
	}
	if _, err := roomCommand(t, s, "owner", "sell", RoomCommand{UnitID: chairUnit.UnitID}); !errors.Is(err, ErrSellValue) {
		t.Fatalf("selling a Grana item: %v", err)
	}
}

func TestTheLastStoveCounterOrDoorIsNeverSold(t *testing.T) {
	s, _ := newCafe(t, "owner")
	room, _ := SnapshotRoom(s, "owner")
	for _, classname := range []string{"starter_stove", "serving_counter", "mafia_door"} {
		item := catalogItem(t, classname)
		unit := unitOf(room, item.ID, true)
		if unit.UnitID == "" {
			t.Fatalf("starter room without %s", classname)
		}
		if _, err := roomCommand(t, s, "owner", "store", RoomCommand{UnitID: unit.UnitID}); err != nil {
			t.Fatalf("store %s: %v", classname, err)
		}
		if _, err := roomCommand(t, s, "owner", "sell", RoomCommand{UnitID: unit.UnitID}); !errors.Is(err, ErrSellLast) {
			t.Fatalf("selling the last %s: %v", classname, err)
		}
	}
	// With a second stove the stored one sells, and its cooking row goes with it.
	setPlayer(t, s, "owner", map[string]any{"gold": 1000, "level": 5, "experience_current": gamerules.Public().Levels[4].RequiredXP})
	if _, err := buy(t, s, "owner", catalogItem(t, "starter_stove").ID, 4, 4); err != nil {
		t.Fatal(err)
	}
	stored := unitOf(room, catalogItem(t, "starter_stove").ID, true)
	if _, err := roomCommand(t, s, "owner", "sell", RoomCommand{UnitID: stored.UnitID}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get("player_stoves", stored.StoveID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("the sold stove still cooks: %v", err)
	}
	cooking, _ := SnapshotCooking(s, "owner", progressT0)
	if len(cooking.Stoves) != 1 {
		t.Fatalf("stoves after the sale = %d", len(cooking.Stoves))
	}
}

func TestReplacedFloorsAndWallsGoBackToTheInventory(t *testing.T) {
	s, _ := newCafe(t, "owner")
	setPlayer(t, s, "owner", map[string]any{"gold": 1000, "level": 10, "experience_current": gamerules.Public().Levels[9].RequiredXP})
	before, _ := SnapshotRoom(s, "owner")
	floor, wall := catalogItem(t, "sky_tile_floor"), catalogItem(t, "cream_wallpaper")
	oldFloor := 0
	for _, u := range before.Inventory {
		if u.Placed && u.TX == 3 && u.TY == 4 {
			if item, _ := roomcatalog.ByID(u.ItemID); item.Type == 0 {
				oldFloor = u.ItemID
			}
		}
	}
	after, err := buy(t, s, "owner", floor.ID, 3, 4)
	if err != nil {
		t.Fatal(err)
	}
	if unitOf(after, oldFloor, false).UnitID == "" {
		t.Fatal("the replaced floor tile left the inventory")
	}
	x, y, rotation := 0, 3, 0
	room, _ := s.First("player_rooms", Where{"user": "owner"})
	revision := room.GetInt("revision")
	papered, err := MutateRoom(s, "owner", "purchase", RoomCommand{ItemID: wall.ID, TX: &x, TY: &y, Rotation: &rotation, Revision: &revision, RequestID: "shop-test-wallpaper-0001"}, progressT0)
	if err != nil {
		t.Fatal(err)
	}
	storedWalls := 0
	for _, u := range papered.Inventory {
		if item, _ := roomcatalog.ByID(u.ItemID); item.Type == 1 && !u.Placed {
			storedWalls++
		}
	}
	if storedWalls != 1 {
		t.Fatalf("stored wallpapers after papering one tile = %d", storedWalls)
	}
	// The stored floor goes back down without paying again.
	stored := unitOf(papered, oldFloor, false)
	gold := papered.PlayerState.Gold
	back, err := roomCommand(t, s, "owner", "move", RoomCommand{UnitID: stored.UnitID, TX: &[]int{3}[0], TY: &[]int{4}[0], Rotation: &[]int{0}[0]})
	if err != nil || back.PlayerState.Gold != gold || unitOf(back, floor.ID, false).UnitID == "" {
		t.Fatalf("floor back: %v", err)
	}
}

func TestStovesAndCountersAreLimitedByTheCafeSize(t *testing.T) {
	s, _ := newCafe(t, "owner")
	setPlayer(t, s, "owner", map[string]any{"gold": 100000, "level": 10, "experience_current": gamerules.Public().Levels[9].RequiredXP})
	stove, counter := catalogItem(t, "starter_stove"), catalogItem(t, "wood_counter")
	limit := gamerules.EquipmentLimit("stove", 8)
	room, _ := SnapshotRoom(s, "owner")
	if room.Equipment.Stoves != (EquipmentCount{Placed: 1, Max: limit}) || room.Equipment.Counters.Placed != 1 {
		t.Fatalf("starter equipment %+v", room.Equipment)
	}
	for i := 1; i < limit; i++ {
		if _, err := buy(t, s, "owner", stove.ID, 3+i, 6); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := buy(t, s, "owner", stove.ID, 6, 6); !errors.Is(err, ErrRoomCapacity) {
		t.Fatalf("one stove too many: %v", err)
	}
	// Moving a placed stove is not a new one.
	full, _ := SnapshotRoom(s, "owner")
	moved := unitOf(full, stove.ID, true)
	if _, err := roomCommand(t, s, "owner", "move", RoomCommand{UnitID: moved.UnitID, TX: &[]int{6}[0], TY: &[]int{7}[0], Rotation: &[]int{0}[0]}); err != nil {
		t.Fatalf("moving a placed stove: %v", err)
	}
	if _, err := buy(t, s, "owner", counter.ID, 2, 7); err != nil {
		t.Fatalf("counters have their own limit: %v", err)
	}
	setRoomTiles(t, s, "owner", 10)
	grown, err := buy(t, s, "owner", stove.ID, 8, 8)
	if err != nil || grown.Equipment.Stoves.Max != gamerules.EquipmentLimit("stove", 10) || grown.Equipment.Stoves.Placed != limit+1 {
		t.Fatalf("after expanding: %+v %v", grown.Equipment, err)
	}
}

func TestMultiStoveYieldsMoreServings(t *testing.T) {
	s, _ := newCafe(t, "owner")
	multi := catalogItem(t, "multi_stove")
	setPlayer(t, s, "owner", map[string]any{"gold": 100000, "level": multi.MinLevel(), "experience_current": gamerules.Public().Levels[multi.MinLevel()-1].RequiredXP})
	if multi.ServingsBonusPercent <= 0 {
		t.Fatal("the multi-stove has no servings bonus")
	}
	bought, err := buy(t, s, "owner", multi.ID, 4, 4)
	if err != nil {
		t.Fatal(err)
	}
	stoveID := unitOf(bought, multi.ID, true).StoveID
	recipe, _ := gamerules.RecipeByID("coxinha")
	if err := StartCooking(s, "owner", stoveID, recipe.ID, progressT0); err != nil {
		t.Fatal(err)
	}
	cooking, _ := SnapshotCooking(s, "owner", progressT0)
	extra := (recipe.Servings*multi.ServingsBonusPercent + 99) / 100
	for _, stove := range cooking.Stoves {
		if stove.ID == stoveID && (stove.Cooking == nil || stove.Cooking.Servings != recipe.Servings+extra) {
			t.Fatalf("multi-stove batch %+v, want %d servings", stove.Cooking, recipe.Servings+extra)
		}
	}
}

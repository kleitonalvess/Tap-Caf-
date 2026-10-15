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
	if capped := gamerules.DecorBonus(many); capped.BonusTenths != rules.MaxBonusTenths || capped.RawTenths <= rules.MaxBonusTenths {
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

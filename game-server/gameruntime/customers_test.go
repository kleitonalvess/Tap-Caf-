package gameruntime

import (
	"encoding/json"
	"testing"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
)

// seatedCustomer sits a customer at the starter chair (2,3) facing the table (3,3).
func seatedCustomer(r *room, now time.Time) *entity {
	customer := &entity{Actor: gamewire.Actor{ID: "npc:seated", Kind: "npc", X: 2, Y: 3, ChairID: "chair", TableID: "table"}}
	r.actors[customer.ID] = customer
	r.seats["chair"] = customer.ID
	r.sit(customer, now)
	return customer
}

func TestSeatedCustomerWaitsForTheWholePatience(t *testing.T) {
	store := &economyStore{}
	r, _ := economyRoom(store)
	r.world.Foods = nil
	now := time.Now()
	customer := seatedCustomer(r, now)
	if customer.Patience == nil || customer.Patience.Duration != gamerules.CustomerPatience().Milliseconds() {
		t.Fatalf("patience not shown: %+v", customer.Patience)
	}
	patience := gamerules.CustomerPatience()
	r.advanceNPC(customer, now.Add(patience-time.Second))
	if customer.State != "seated" {
		t.Fatalf("left before the patience ran out: %s", customer.State)
	}
	r.advanceNPC(customer, now.Add(patience))
	if customer.State != "wandering" || customer.Patience != nil || customer.ChairID != "" {
		t.Fatalf("after patience: state=%s patience=%+v chair=%q", customer.State, customer.Patience, customer.ChairID)
	}
	r.advanceNPC(customer, now.Add(patience+time.Second))
	r.manager.wg.Wait()
	if len(store.feedbacks) != 1 || store.feedbacks[0] {
		t.Fatalf("impatient customer verdicts = %v", store.feedbacks)
	}
}

func TestSeatedCustomerEatsFoodThatArrivesInTime(t *testing.T) {
	store := &economyStore{payment: gamewire.Payment{RecipeID: "cake_1", Coins: 4, XP: 1, ServingsLeft: 3, PopularityTenths: 801}}
	r, _ := economyRoom(store)
	dish := r.world.Foods
	r.world.Foods = nil
	now := time.Now()
	customer := seatedCustomer(r, now)
	r.advanceNPC(customer, now.Add(20*time.Second))
	r.world.Foods = dish
	r.advanceNPC(customer, now.Add(30*time.Second))
	if customer.State != "eating" || customer.Patience != nil || len(store.consumed) != 1 {
		t.Fatalf("state=%s patience=%+v consumed=%v", customer.State, customer.Patience, store.consumed)
	}
}

func TestCustomersNeedADiningSeat(t *testing.T) {
	r, _ := economyRoom(&economyStore{})
	now := time.Now()
	if len(r.diningChairs()) != 1 || !r.shouldSpawn(now) {
		t.Fatalf("starter seat not available: chairs=%d", len(r.diningChairs()))
	}
	r.actors["npc:a"] = &entity{Actor: gamewire.Actor{ID: "npc:a", Kind: "npc", State: "wandering"}}
	if r.shouldSpawn(now) {
		t.Fatal("spawned more customers than dining seats")
	}
	r.actors["npc:a"].State = "leaving"
	if !r.shouldSpawn(now) {
		t.Fatal("a leaving customer still held the seat")
	}
	// Without the table the chair is not a dining seat.
	r.world.Units = r.world.Units[:2]
	r.grid = newGrid(r.world)
	delete(r.actors, "npc:a")
	if r.shouldSpawn(now) {
		t.Fatal("spawned without any dining seat")
	}
}

func TestArrivalsSlowDownWhileCookingWithEmptyCounters(t *testing.T) {
	r, _ := economyRoom(&economyStore{})
	r.popularity = 1050 // 25 per minute: 2.4 s base
	now := time.Now()
	cooking, _ := json.Marshal(map[string]any{"stoves": []any{map[string]any{"id": "s", "cooking": map[string]string{
		"readyAt": now.Add(time.Minute).UTC().Format(time.RFC3339Nano)}}}})
	r.world.Cooking = cooking
	for i := 0; i < 50; i++ {
		// Food on a counter: normal pace (2.4 s ± 25%).
		if got := r.arrivalInterval(now); got < 1800*time.Millisecond || got > 3*time.Second {
			t.Fatalf("with food: %v", got)
		}
	}
	r.world.Foods = nil
	factor := gamerules.CookingArrivalFactor()
	low, high := time.Duration(float64(1800*time.Millisecond)*factor), time.Duration(float64(3*time.Second)*factor)
	for i := 0; i < 50; i++ {
		if got := r.arrivalInterval(now); got < low || got > high {
			t.Fatalf("cooking with empty counters: %v not in %v..%v", got, low, high)
		}
	}
}

func TestDormancySavesRemainingPatience(t *testing.T) {
	store := &economyStore{}
	r, _ := economyRoom(store)
	r.world.Foods = nil
	now := time.Now()
	customer := seatedCustomer(r, now)
	customer.Kind = "npc"
	if err := r.sleep(now.Add(10 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if store.slept == nil || len(store.slept.NPCs) != 1 {
		t.Fatalf("saved NPCs = %+v", store.slept)
	}
	want := (gamerules.CustomerPatience() - 10*time.Second).Milliseconds()
	if got := store.slept.NPCs[0].PatienceRemaining; got < want-5 || got > want+5 {
		t.Fatalf("saved patience = %d ms, want about %d", got, want)
	}
	if r.status(customer, true).PatienceRemaining != 0 {
		t.Fatal("dormancy-only field broadcast")
	}
}

func TestFoodChangesAreBroadcastAsACompleteList(t *testing.T) {
	r, peer := economyRoom(&economyStore{})
	world := r.world
	world.Foods = []gamewire.Food{}
	r.updateWorld(world)
	found := false
	for _, event := range events(peer) {
		if event.Type == "world" && len(event.Foods) > 0 {
			t.Fatal("world event carried foods")
		}
		if event.Type == "food" {
			found = true
		}
	}
	if !found {
		t.Fatal("emptied counters were not broadcast")
	}
}

package gameruntime

import (
	"encoding/json"
	"testing"
	"time"

	"coffe-mania/shared/gamewire"
)

func TestMealLeavesItsPlateOnTheTable(t *testing.T) {
	store := &economyStore{payment: gamewire.Payment{RecipeID: "cake_1", Coins: 4, XP: 1, ServingsLeft: 3, PopularityTenths: 801}}
	r, peer := economyRoom(store)
	now := time.Now()
	customer := seatedCustomer(r, now)
	customer.Kind = "npc"
	r.advanceNPC(customer, now.Add(time.Second))
	dirt := r.dirtOn("table")
	if customer.State != "eating" || dirt == nil || dirt.Plates != 1 {
		t.Fatalf("state=%s dirt=%+v", customer.State, r.world.Dirt)
	}
	broadcast := false
	for _, event := range events(peer) {
		if event.Type == "dirt" && len(event.Dirt) == 1 && event.Dirt[0].TableID == "table" {
			broadcast = true
		}
	}
	if !broadcast {
		t.Fatal("the dirty table was not broadcast")
	}
}

func TestCustomersDoNotSitAtDirtyTables(t *testing.T) {
	store := &economyStore{}
	r, _ := economyRoom(store)
	now := time.Now()
	r.world.Dirt = []gamewire.Dirt{{TableID: "table", Plates: 1, Since: now.UnixMilli()}}
	// Dirty seats still bring customers in; they complain instead of sitting.
	if !r.shouldSpawn(now) {
		t.Fatal("a dirty table should not stop arrivals")
	}
	customer := &entity{Actor: gamewire.Actor{ID: "npc:w", Kind: "npc", X: 5, Y: 5, State: "wandering"}}
	r.actors[customer.ID] = customer
	r.advanceNPC(customer, now)
	if customer.ChairID != "" {
		t.Fatalf("sat at a dirty table: %q", customer.ChairID)
	}
	customer.visits = 3
	customer.path = nil
	customer.Move = nil
	r.advanceNPC(customer, now.Add(5*time.Second))
	r.manager.wg.Wait()
	if customer.State != "leaving" || len(store.feedbacks) != 1 || store.feedbacks[0] {
		t.Fatalf("state=%s verdicts=%v", customer.State, store.feedbacks)
	}
	r.world.Dirt = nil
	other := &entity{Actor: gamewire.Actor{ID: "npc:x", Kind: "npc", X: 5, Y: 5, State: "wandering"}}
	r.actors[other.ID] = other
	r.advanceNPC(other, now)
	if other.ChairID != "chair" {
		t.Fatalf("clean table not used: %q", other.ChairID)
	}
}

func TestCleaningATableNeedsTheOwnerBesideIt(t *testing.T) {
	r, _ := economyRoom(&economyStore{})
	now := time.Now()
	owner := &entity{Actor: gamewire.Actor{ID: "human:owner", Kind: "human", X: 6, Y: 6, State: "idle"}}
	r.actors[owner.ID] = owner
	op := gamewire.Operation{Owner: "owner", User: "owner", Action: "table_clean", Body: json.RawMessage(`{"tableId":"table"}`)}
	if message := r.validateOperation(op); message != "Aproxime seu personagem da mesa." {
		t.Fatalf("far away: %q", message)
	}
	owner.X, owner.Y = 3, 4
	if message := r.validateOperation(op); message != "A mesa já está limpa." {
		t.Fatalf("clean table: %q", message)
	}
	r.world.Dirt = []gamewire.Dirt{{TableID: "table", Plates: 2, Since: now.UnixMilli()}}
	if message := r.validateOperation(op); message != "" {
		t.Fatalf("dirty table beside the owner: %q", message)
	}
	table, _ := r.adjacentUnit(owner, "table", "table")
	r.startUnitAction(owner, table, "cleaning", now, time.Second)
	if owner.State != "cleaning" || owner.Action == nil || owner.Action.Kind != "cleaning" {
		t.Fatalf("cleaning action = %s %+v", owner.State, owner.Action)
	}
	if message := r.validateOperation(op); message != "Aguarde terminar a ação." {
		t.Fatalf("while cleaning: %q", message)
	}
}

func TestOnlyDirtyTablesLetOneCustomerInAtATime(t *testing.T) {
	r, _ := economyRoom(&economyStore{})
	now := time.Now()
	r.world.Units = append(r.world.Units, gamewire.Unit{ID: "chair2", ItemID: 3040001, Placed: true, X: 4, Y: 3, Rotation: 2})
	r.grid = newGrid(r.world)
	r.world.Dirt = []gamewire.Dirt{{TableID: "table", Plates: 1, Since: now.UnixMilli()}}
	if !r.shouldSpawn(now) {
		t.Fatal("dirty tables still bring one customer")
	}
	r.actors["npc:a"] = &entity{Actor: gamewire.Actor{ID: "npc:a", Kind: "npc", State: "wandering"}}
	if r.shouldSpawn(now) {
		t.Fatal("a second customer came in with only dirty tables")
	}
	r.world.Dirt = nil
	if !r.shouldSpawn(now) {
		t.Fatal("clean tables should admit the second customer")
	}
}

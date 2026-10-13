package gameruntime

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
)

type economyStore struct {
	mu        sync.Mutex
	payment   gamewire.Payment
	consumed  []string
	feedbacks []bool
	slept     *gamewire.Sleep
}

func (s *economyStore) Load(context.Context, string) (gamewire.Seed, error) {
	return gamewire.Seed{}, nil
}
func (s *economyStore) Active(context.Context, string, int) error { return nil }
func (s *economyStore) Sleep(_ context.Context, _ string, state gamewire.Sleep) error {
	s.slept = &state
	return nil
}
func (s *economyStore) Operate(context.Context, gamewire.Operation) (gamewire.Result, error) {
	return gamewire.Result{}, nil
}
func (s *economyStore) Consume(_ context.Context, _ string, food string) (gamewire.Payment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.consumed = append(s.consumed, food)
	return s.payment, nil
}
func (s *economyStore) Feedback(_ context.Context, _ string, satisfied bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.feedbacks = append(s.feedbacks, satisfied)
	return nil
}

// Starter layout ids: door 3010000, chair 3040001, table 3030010.
func economyRoom(store Storage) (*room, *Peer) {
	world := gamewire.World{RoomID: "owner", TilesX: 8, TilesY: 8, Units: []gamewire.Unit{
		{ID: "door", ItemID: 3010000, Placed: true, X: 4, Y: 1, Rotation: 1},
		{ID: "chair", ItemID: 3040001, Placed: true, X: 2, Y: 3},
		{ID: "table", ItemID: 3030010, Placed: true, X: 3, Y: 3},
	}, Foods: []gamewire.Food{{ID: "dish", Recipe: "cake_1", Servings: 4}}}
	peer := &Peer{ID: "peer", Out: make(chan []byte, 32), Kick: func() {}}
	r := &room{manager: New(store, Options{}), id: "owner", world: world, grid: newGrid(world),
		actors: map[string]*entity{}, peers: map[string]*Peer{"peer": peer}, seats: map[string]string{},
		occupancy: map[Tile]map[string]bool{}, actorTiles: map[string][]Tile{}, popularity: 800}
	return r, peer
}

func events(peer *Peer) []gamewire.Event {
	list := []gamewire.Event{}
	for {
		select {
		case data := <-peer.Out:
			var event gamewire.Event
			_ = json.Unmarshal(data, &event)
			list = append(list, event)
		default:
			return list
		}
	}
}

func TestSeatedCustomerTakesOneServingAndPaysOnce(t *testing.T) {
	store := &economyStore{payment: gamewire.Payment{RecipeID: "cake_1", Coins: 4, XP: 1, Level: 1, ServingsLeft: 3, PopularityTenths: 801}}
	r, peer := economyRoom(store)
	customer := &entity{Actor: gamewire.Actor{ID: "npc:1", Kind: "npc", X: 2, Y: 3, State: "seated", ChairID: "chair", TableID: "table"}}
	r.actors[customer.ID] = customer
	r.seats["chair"] = customer.ID
	now := time.Now()

	countPayments := func() int {
		payments := 0
		for _, event := range events(peer) {
			if event.Type == "payment" {
				payments++
				if event.Payment == nil || event.Payment.ActorID != customer.ID || event.Payment.Coins != 4 {
					t.Fatalf("payment event = %+v", event.Payment)
				}
			}
		}
		return payments
	}
	r.advanceNPC(customer, now)
	if customer.State != "eating" || len(store.consumed) != 1 || r.world.Foods[0].Servings != 3 || r.popularity != 801 {
		t.Fatalf("after serving: state=%s consumed=%v foods=%+v popularity=%d", customer.State, store.consumed, r.world.Foods, r.popularity)
	}
	if got := countPayments(); got != 1 {
		t.Fatalf("payments when served = %d, want 1", got)
	}

	r.advanceNPC(customer, now.Add(8*time.Second))
	if got := countPayments(); got != 0 || customer.Emotion == nil || customer.Emotion.Kind != "satisfied" {
		t.Fatalf("after eating: payments=%d emotion=%+v", got, customer.Emotion)
	}
}

func TestLastServingRemovesDish(t *testing.T) {
	r, _ := economyRoom(&economyStore{})
	r.takeServing("dish", 0)
	if len(r.world.Foods) != 0 {
		t.Fatalf("empty dish kept: %+v", r.world.Foods)
	}
}

func TestUnservedCustomerComplainsOnce(t *testing.T) {
	store := &economyStore{}
	r, _ := economyRoom(store)
	customer := &entity{Actor: gamewire.Actor{ID: "npc:2", Kind: "npc", X: 5, Y: 5, State: "wandering"}}
	r.actors[customer.ID] = customer
	now := time.Now()
	r.exitNPC(customer, now)
	r.exitNPC(customer, now.Add(time.Second))
	r.manager.wg.Wait()
	if len(store.feedbacks) != 1 || store.feedbacks[0] {
		t.Fatalf("feedbacks = %v, want one unsatisfied verdict", store.feedbacks)
	}
	if want := gamerules.ApplyCustomer(800, false); r.popularity != want {
		t.Fatalf("popularity = %d, want %d", r.popularity, want)
	}

	served := &entity{Actor: gamewire.Actor{ID: "npc:3", Kind: "npc", X: 5, Y: 6, State: "wandering", EmotionShown: true}}
	r.actors[served.ID] = served
	r.exitNPC(served, now)
	r.manager.wg.Wait()
	if len(store.feedbacks) != 1 {
		t.Fatalf("a satisfied customer complained: %v", store.feedbacks)
	}
}

func TestArrivalIntervalFollowsPopularity(t *testing.T) {
	r, _ := economyRoom(&economyStore{})
	r.popularity = 50
	slowest := r.arrivalInterval(time.Now())
	r.popularity = 1050
	fastest := r.arrivalInterval(time.Now())
	// 5/min at the minimum (12s ± 25%) and 25/min at the maximum (2.4s ± 25%).
	if slowest < 9*time.Second || slowest > 15*time.Second || fastest < 1800*time.Millisecond || fastest > 3*time.Second {
		t.Fatalf("intervals: slowest=%v fastest=%v", slowest, fastest)
	}
}

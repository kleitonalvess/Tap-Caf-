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
	waiter    []bool
	feedbacks []bool
	cleaned   []string
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
func (s *economyStore) Consume(_ context.Context, _ string, food, _ string, waiter bool) (gamewire.Payment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.consumed = append(s.consumed, food)
	s.waiter = append(s.waiter, waiter)
	payment := s.payment
	if waiter {
		payment.Tip = 1
		payment.Coins++
	}
	return payment, nil
}
func (s *economyStore) Clean(_ context.Context, _ string, table string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleaned = append(s.cleaned, table)
	return nil
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
		occupancy: map[Tile]map[string]bool{}, actorTiles: map[string][]Tile{}, popularity: 800,
		reserved: map[string]int{}, claimed: map[string]string{}}
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
	pickup := now.Add(gamerules.SelfPickup())
	r.advanceNPC(customer, pickup)
	if customer.State != "eating" || len(store.consumed) != 1 || r.world.Foods[0].Servings != 3 || r.popularity != 801 {
		t.Fatalf("after serving: state=%s consumed=%v foods=%+v popularity=%d", customer.State, store.consumed, r.world.Foods, r.popularity)
	}
	if got := countPayments(); got != 1 {
		t.Fatalf("payments when served = %d, want 1", got)
	}

	r.advanceNPC(customer, pickup.Add(8*time.Second))
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

func TestExpansionGrowsTheGridLive(t *testing.T) {
	r, peer := economyRoom(&economyStore{})
	if r.grid.walkable(Tile{X: 9, Y: 9}) {
		t.Fatal("8x8 room walks on (9,9)")
	}
	grown := r.world
	grown.TilesX, grown.TilesY, grown.Revision = 10, 10, 2
	grown.Units = append(append([]gamewire.Unit{}, r.world.Units...), gamewire.Unit{ID: "floor-9-9", ItemID: 3050000, Placed: true, X: 9, Y: 9})
	r.updateWorld(grown)
	if r.grid.width != 10 || r.grid.height != 10 || !r.grid.walkable(Tile{X: 9, Y: 9}) {
		t.Fatalf("grid = %dx%d", r.grid.width, r.grid.height)
	}
	// Furniture kept its footprint in the rebuilt grid.
	if r.grid.walkable(Tile{X: 3, Y: 3}) {
		t.Fatal("the table tile became walkable")
	}
	sized := false
	for _, event := range events(peer) {
		if event.Type == "world" && event.TilesX == 10 && event.TilesY == 10 && event.Revision == 2 {
			sized = true
		}
	}
	if !sized {
		t.Fatal("the new size was not broadcast")
	}
	a := &entity{Actor: gamewire.Actor{ID: "npc:walker", Kind: "npc", X: 2, Y: 2}}
	r.actors[a.ID] = a
	if !r.route(a, Tile{X: 9, Y: 9}, time.Now()) {
		t.Fatal("no path to a new tile")
	}
}

func TestPartyBringsCustomersMoreOften(t *testing.T) {
	r, peer := economyRoom(&economyStore{})
	now := time.Now()
	calm := time.Duration(0)
	for i := 0; i < 200; i++ {
		calm += r.arrivalInterval(now)
	}
	party := r.world
	party.Street = &gamewire.Street{PartyStartedAt: now.UnixMilli(), PartyEndsAt: now.Add(5 * time.Minute).UnixMilli()}
	r.updateWorld(party)
	busy := time.Duration(0)
	for i := 0; i < 200; i++ {
		busy += r.arrivalInterval(now)
	}
	factor := float64(calm) / float64(busy)
	if factor < gamerules.Street().Disco.ArrivalFactor*0.8 || factor > gamerules.Street().Disco.ArrivalFactor*1.25 {
		t.Fatalf("arrivals during the party are %.2fx as frequent", factor)
	}
	broadcast := false
	for _, event := range events(peer) {
		if event.Type == "world" && event.Street != nil && event.Street.PartyEndsAt == party.Street.PartyEndsAt {
			broadcast = true
		}
	}
	if !broadcast {
		t.Fatal("the party was not broadcast")
	}
	if r.world.Street.PartyActive(now.Add(6 * time.Minute).UnixMilli()) {
		t.Fatal("the party never ends")
	}
}

func TestOwnerHearsTheAbsenceOnceOnWelcome(t *testing.T) {
	r, _ := economyRoom(&economyStore{})
	r.away = &gamewire.AwaySummary{Served: 4, Coins: 20, To: time.Now().UnixMilli()}
	visitor := &Peer{ID: "v", Out: make(chan []byte, 64), Kick: func() {}, Ticket: gamewire.Ticket{User: "visitor", Room: r.id}}
	if err := r.join(visitor); err != nil {
		t.Fatal(err)
	}
	for _, event := range events(visitor) {
		if event.Away != nil {
			t.Fatal("a visitor got the owner's summary")
		}
	}
	owner := &Peer{ID: "o", Out: make(chan []byte, 64), Kick: func() {}, Ticket: gamewire.Ticket{User: r.id, Room: r.id}}
	if err := r.join(owner); err != nil {
		t.Fatal(err)
	}
	got := 0
	for _, event := range events(owner) {
		if event.Type == "welcome" && event.Away != nil && event.Away.Served == 4 {
			got++
		}
	}
	if got != 1 || r.away != nil {
		t.Fatalf("owner welcomes with the summary = %d, left in memory = %+v", got, r.away)
	}
}

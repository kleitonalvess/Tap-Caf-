package gameruntime

// Customer state machine: entering → wandering (looking for a clean dining seat)
// → to_seat → seated (waiting for food, with patience) → eating → wandering →
// leaving. Each meal leaves its plate on the table, which seats nobody until it
// is cleared. Only the room goroutine runs it; persistence calls are the only I/O.

import (
	"context"
	"errors"
	"log"
	"math/rand/v2"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/roomcatalog"
	"github.com/google/uuid"
)

func (r *room) spawnNPC(now time.Time) {
	if len(r.looks) == 0 {
		return
	}
	door, ok := r.grid.door()
	if !ok {
		return
	}
	entry := opening(door)
	start := Tile{X: entry.X, Y: -8}
	turn := Tile{X: entry.X, Y: entry.Y}
	if entry.Y == 0 {
		start = Tile{X: r.grid.width + 8, Y: entry.Y}
		turn = Tile{X: entry.X, Y: entry.Y}
	}
	// External actors stay one tile beyond the walls until the actual doorway.
	if entry.X == 0 {
		start.X = -1
		turn.X = -1
	} else {
		start.Y = -1
		turn.Y = -1
	}
	look := r.looks[rand.IntN(len(r.looks))]
	for _, a := range r.actors {
		if a.Kind == "npc" && a.Appearance == look {
			return
		}
	}
	a := &entity{Actor: gamewire.Actor{ID: "npc:" + uuid.NewString(), Kind: "npc", Name: "Cliente", Appearance: look, X: start.X, Y: start.Y, Outside: true, State: "entering", Browsing: r.kitchenIdle(now)}}
	a.path = append(line(start, turn), line(turn, entry)...)
	a.path = append(a.path, Tile{X: door.X, Y: door.Y})
	r.actors[a.ID] = a
	r.nextStep(a, now)
	r.broadcast(gamewire.Event{Type: "actors", Actors: []gamewire.Actor{r.status(a, true)}}, "")
}

// arrivalInterval follows the popularity band, with ±25% jitter so customers
// do not arrive in lockstep. MaxNPCs still caps how many are inside.
func (r *room) arrivalInterval(now time.Time) time.Duration {
	base := time.Minute / time.Duration(gamerules.CustomersPerMinute(r.popularity))
	// Empty counters with food on the way: fewer arrivals while the owner cooks.
	if len(r.world.Foods) == 0 && r.cookingInProgress(now) {
		base = time.Duration(float64(base) * gamerules.CookingArrivalFactor())
	}
	return time.Duration(float64(base) * (0.75 + rand.Float64()/2))
}

// diningChairs are placed chairs facing a table: the only seats where a customer
// can eat. Dirty tables still count here, so customers keep coming and complain.
func (r *room) diningChairs() []Unit {
	chairs := []Unit{}
	for _, u := range r.world.Units {
		if item, _ := roomcatalog.ByID(u.ItemID); u.Placed && item.Kind == "chair" && r.chairTable(u) != "" {
			chairs = append(chairs, u)
		}
	}
	return chairs
}

// chairTable is the table a chair faces, or "" when there is none.
func (r *room) chairTable(chair Unit) string {
	d := []Tile{{X: 1, Y: 0}, {X: 0, Y: 1}, {X: -1, Y: 0}, {X: 0, Y: -1}}[chair.Rotation%4]
	for _, other := range r.grid.objects[Tile{X: chair.X + d.X, Y: chair.Y + d.Y}] {
		if item, _ := roomcatalog.ByID(other.ItemID); item.Kind == "table" {
			return other.ID
		}
	}
	return ""
}

func (r *room) dirtOn(tableID string) *gamewire.Dirt {
	for i := range r.world.Dirt {
		if r.world.Dirt[i].TableID == tableID {
			return &r.world.Dirt[i]
		}
	}
	return nil
}

// addDirt mirrors the plate that persistence left on the table with the payment.
func (r *room) addDirt(tableID string, now time.Time) {
	if tableID == "" {
		return
	}
	if dirt := r.dirtOn(tableID); dirt != nil {
		dirt.Plates++
	} else {
		r.world.Dirt = append(r.world.Dirt, gamewire.Dirt{TableID: tableID, Plates: 1, Since: now.UnixMilli()})
	}
	r.broadcast(gamewire.Event{Type: "dirt", Dirt: r.world.Dirt}, "")
}

// shouldSpawn admits a customer only when a dining seat could be waiting for
// them; leaving customers do not count, but the total stays bounded. With the
// kitchen idle only one customer comes in to look at the menu.
func (r *room) shouldSpawn(now time.Time) bool {
	if now.Before(r.spawnAt) {
		return false
	}
	active, total := 0, 0
	for _, a := range r.actors {
		if a.Kind == "npc" {
			total++
			if a.State != "leaving" {
				active++
			}
		}
	}
	capacity := min(r.manager.options.MaxNPCs, len(r.diningChairs()))
	if r.kitchenIdle(now) {
		capacity = min(capacity, 1)
	}
	return active < capacity && total < 2*r.manager.options.MaxNPCs
}

// watchKitchen gives customers who came in to browse a full wait once the
// first dish goes on the fire, so starting to cook never costs popularity.
func (r *room) watchKitchen(now time.Time) {
	idle := r.kitchenIdle(now)
	woke := r.kitchenKnown && r.kitchenWasIdle && !idle
	r.kitchenWasIdle, r.kitchenKnown = idle, true
	if !woke {
		return
	}
	updates := []gamewire.Actor{}
	for _, a := range r.actors {
		if a.Kind == "npc" && a.Browsing && a.State == "seated" && a.Food == nil && !a.patienceUntil.IsZero() {
			a.restorePatience(now.Add(gamerules.CustomerPatience()))
			updates = append(updates, r.status(a, false))
		}
	}
	if len(updates) > 0 {
		r.broadcast(gamewire.Event{Type: "actors", Actors: updates}, "")
	}
}

func (a *entity) restorePatience(until time.Time) {
	duration := gamerules.CustomerPatience()
	a.patienceUntil = until
	a.Patience = &gamewire.Patience{StartedAt: until.Add(-duration).UnixMilli(), Duration: duration.Milliseconds()}
}

func (a *entity) clearPatience() {
	a.patienceUntil = time.Time{}
	a.Patience = nil
}

func (r *room) advanceNPC(a *entity, now time.Time) bool {
	switch a.State {
	case "entering":
		a.Outside = false
		a.State = "wandering"
		a.due = now.Add(time.Second)
	case "wandering":
		if a.visits < 2 {
			for _, u := range r.diningChairs() {
				if r.seats[u.ID] == "" && r.dirtOn(r.chairTable(u)) == nil && r.reserveChair(a, u.ID, now) {
					return false
				}
			}
		}
		if a.visits >= 3 {
			r.exitNPC(a, now)
			return false
		}
		tiles := []Tile{}
		for y := 1; y < r.grid.height; y++ {
			for x := 1; x < r.grid.width; x++ {
				t := Tile{X: x, Y: y}
				if r.grid.walkable(t) && !r.occupied(t, a.ID) {
					tiles = append(tiles, t)
				}
			}
		}
		if len(tiles) > 0 {
			r.route(a, tiles[rand.IntN(len(tiles))], now)
		}
		a.visits++
		a.due = now.Add(2 * time.Second)
	case "seated":
		// A waiter is bringing the dish: the wait is paused until the hand-over.
		if a.servedBy != "" {
			a.due = now.Add(time.Second)
			return false
		}
		// Customers saved before patience existed get the full wait now.
		if a.patienceUntil.IsZero() {
			a.restorePatience(now.Add(gamerules.CustomerPatience()))
		}
		// Without waiters on duty customers help themselves at the counter.
		if food, ok := r.availableFood(); ok && a.TableID != "" && !r.waitersOnDuty() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			payment, err := r.manager.store.Consume(ctx, r.id, food.ID, a.TableID)
			cancel()
			if err == nil {
				r.startMeal(a, food, payment, now)
				return false
			}
			if errors.Is(err, ErrFoodGone) {
				// Drop the stale entry, so the next customer tries the following dish.
				r.takeServing(food.ID, 0)
				r.broadcast(gamewire.Event{Type: "food", Foods: r.world.Foods}, "")
			}
		}
		if !now.Before(a.patienceUntil) {
			// Out of patience: stands up and complains on the way out (exitNPC).
			r.standNPC(a, now)
			return false
		}
		a.due = now.Add(time.Second)
	case "eating":
		r.standNPC(a, now)
	case "leaving":
		if a.Outside {
			return true
		}
		r.exitNPC(a, now)
	}
	return false
}

// startMeal mirrors a credited serving: the counter loses it, the table gets the
// plate, the customer eats and everyone sees the coins over the customer.
func (r *room) startMeal(a *entity, food gamewire.Food, payment gamewire.Payment, now time.Time) {
	r.takeServing(food.ID, payment.ServingsLeft)
	r.addDirt(a.TableID, now)
	food.Servings = 0
	food.CounterID = ""
	a.Food = &food
	a.clearPatience()
	r.popularity = payment.PopularityTenths
	a.State = "eating"
	a.due = now.Add(8 * time.Second)
	a.Action = &gamewire.ActorAction{Kind: "eating", StartedAt: now.UnixMilli(), Duration: 8000}
	r.broadcast(gamewire.Event{Type: "food", Foods: r.world.Foods}, "")
	// Shown when credited: the owner's HUD updates from the same transaction.
	payment.ActorID = a.ID
	r.broadcast(gamewire.Event{Type: "payment", Payment: &payment}, "")
}

// takeServing mirrors persistence after a serving was taken or found missing.
func (r *room) takeServing(foodID string, left int) {
	foods := r.world.Foods[:0:0]
	for _, food := range r.world.Foods {
		if food.ID == foodID {
			if left <= 0 {
				continue
			}
			food.Servings = left
		}
		foods = append(foods, food)
	}
	r.world.Foods = foods
}

// reportUnsatisfied applies the verdict locally and persists it off the room
// goroutine; the HTTP call never touches room state.
func (r *room) reportUnsatisfied() {
	r.popularity = gamerules.ApplyCustomer(r.popularity, false)
	r.manager.wg.Add(1)
	go func() {
		defer r.manager.wg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := r.manager.store.Feedback(ctx, r.id, false); err != nil {
			log.Printf("customer feedback not saved: room=%s error=%v", r.id, err)
		}
	}()
}

func (r *room) standNPC(a *entity, now time.Time) {
	dest, ok := r.freeNeighbour(Tile{X: a.X, Y: a.Y}, a)
	if !ok {
		a.due = now.Add(time.Second)
		return
	}
	r.releaseSeat(a)
	a.Action = nil
	a.clearPatience()
	if a.State == "eating" {
		r.startEmotion(a, "satisfied", now)
	}
	a.State = "wandering"
	a.visits = 3
	r.route(a, dest, now)
	a.due = now.Add(time.Second)
}

func (r *room) exitNPC(a *entity, now time.Time) {
	door, ok := r.grid.door()
	if !ok {
		a.State = "wandering"
		a.due = now.Add(3 * time.Second)
		return
	}
	entry := Tile{X: door.X, Y: door.Y}
	a.State = "leaving"
	a.Action = nil
	// A customer shows one verdict. Without the satisfied one from eating, this
	// exit is a complaint and costs popularity exactly once (the flag is saved).
	// With nothing to eat in the whole café, or for a customer who came in while
	// it was so, the visit was only browsing: a neutral face and no penalty.
	if !a.EmotionShown {
		if a.Browsing || r.kitchenIdle(now) {
			r.startEmotion(a, "neutral", now)
		} else {
			r.reportUnsatisfied()
		}
	}
	r.startEmotion(a, "dissatisfied", now)
	if (Tile{X: a.X, Y: a.Y}) != entry {
		if !r.route(a, entry, now) {
			a.due = now.Add(time.Second)
		}
		return
	}
	a.Outside = true
	openingTile := opening(door)
	turn := openingTile
	exit := Tile{X: -1, Y: r.grid.height + 8}
	if openingTile.X == 0 {
		turn.X = -1
	} else {
		turn.Y = -1
		exit = Tile{X: r.grid.width + 8, Y: -1}
	}
	a.path = append(line(entry, openingTile), line(openingTile, turn)...)
	a.path = append(a.path, line(turn, exit)...)
	r.nextStep(a, now)
}

package gameruntime

// Staff simulation. Waiters reserve a serving on a counter, pick it up, carry
// it on a tray to a seated customer and hand it over (the payment is credited
// then); when nobody waits for food they clear dirty tables. Cleaners only
// clear tables. Staff live in memory: the roster comes from persistence with
// the world, and an unfinished job is simply dropped (nothing was saved yet).

import (
	"context"
	"errors"
	"log"
	"sort"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/roomcatalog"
)

type staffJob struct {
	kind     string // "deliver", "bus" or "clean"
	phase    string // "to_counter", "picking", "carrying", "to_table", "working"
	customer string
	food     gamewire.Food
	table    string
}

const staffIdleWait = time.Second

// syncStaff makes the staff actors match world.Staff: hires appear inside the
// café, dismissals leave, a new role drops the current job.
func (r *room) syncStaff(now time.Time) {
	wanted := map[string]gamewire.StaffMember{}
	for _, m := range r.world.Staff {
		if gamerules.ValidRole(m.Role) {
			wanted["staff:"+m.ID] = m
		}
	}
	updated := []gamewire.Actor{}
	removed := []string{}
	for id, a := range r.actors {
		if a.Kind != "staff" {
			continue
		}
		m, ok := wanted[id]
		if !ok {
			r.dropJob(a, now)
			delete(r.actors, id)
			r.unindexActor(id)
			removed = append(removed, id)
			continue
		}
		delete(wanted, id)
		if a.Role != m.Role || a.Name != m.Name || a.Appearance != m.Appearance {
			r.dropJob(a, now)
			a.Role, a.Name, a.Appearance = m.Role, m.Name, m.Appearance
			updated = append(updated, r.status(a, true))
		}
	}
	for _, m := range r.world.Staff {
		id := "staff:" + m.ID
		if _, ok := wanted[id]; !ok {
			continue
		}
		tile, ok := r.freeTile(r.staffEntrance(), "")
		if !ok {
			continue
		}
		a := &entity{Actor: gamewire.Actor{ID: id, Kind: "staff", Name: m.Name, Appearance: m.Appearance, Role: m.Role, X: tile.X, Y: tile.Y, Direction: 1, State: "idle"}}
		a.due = now.Add(staffIdleWait)
		r.actors[id] = a
		r.indexActor(a)
		updated = append(updated, r.status(a, true))
	}
	if len(updated) > 0 || len(removed) > 0 {
		r.broadcast(gamewire.Event{Type: "actors", Actors: updated, Removed: removed}, "")
	}
}

// staffEntrance is the first tile inside the door, where new staff appear.
func (r *room) staffEntrance() Tile {
	if door, ok := r.grid.door(); ok {
		inside := opening(door)
		if inside.X == 0 {
			inside.X = 1
		}
		if inside.Y == 0 {
			inside.Y = 1
		}
		return inside
	}
	return Tile{X: 4, Y: 4}
}

func (r *room) waitersOnDuty() bool {
	for _, a := range r.actors {
		if a.Kind == "staff" && a.Role == gamerules.RoleWaiter {
			return true
		}
	}
	return false
}

// availableFood is the first dish with a serving that no waiter has promised.
func (r *room) availableFood() (gamewire.Food, bool) {
	for _, food := range r.world.Foods {
		if max(1, food.Servings)-r.reserved[food.ID] > 0 {
			return food, true
		}
	}
	return gamewire.Food{}, false
}

func (r *room) unit(id string) (Unit, bool) {
	for _, u := range r.world.Units {
		if u.ID == id && u.Placed {
			return u, true
		}
	}
	return Unit{}, false
}

// approach finds the nearest free tile beside the unit and a path to it.
func (r *room) approach(a *entity, u Unit) (Tile, []Tile, bool) {
	here := Tile{X: a.X, Y: a.Y}
	best, bestPath, found := Tile{}, []Tile(nil), false
	for _, t := range footprint(u) {
		for _, d := range []Tile{{X: 1}, {X: -1}, {Y: 1}, {Y: -1}} {
			next := Tile{X: t.X + d.X, Y: t.Y + d.Y}
			if !r.grid.inside(next) || !r.grid.walkable(next) || r.occupied(next, a.ID) {
				continue
			}
			if next == here {
				return next, nil, true
			}
			path := findPath(here, next, func(t Tile) bool { return r.canWalk(t, a) }, r.grid.width*r.grid.height*4)
			if path != nil && (!found || len(path) < len(bestPath)) {
				best, bestPath, found = next, path, true
			}
		}
	}
	return best, bestPath, found
}

func (r *room) beside(a *entity, u Unit) bool {
	for _, t := range footprint(u) {
		if abs(a.X-t.X)+abs(a.Y-t.Y) == 1 {
			return true
		}
	}
	return false
}

// walkTo starts the path to a tile beside the unit; false when unreachable.
func (r *room) walkTo(a *entity, u Unit, now time.Time) bool {
	tile, path, ok := r.approach(a, u)
	if !ok {
		return false
	}
	if len(path) > 0 && !r.route(a, tile, now) {
		return false
	}
	return true
}

func (r *room) advanceStaff(a *entity, now time.Time) {
	if a.job == nil {
		r.findStaffWork(a, now)
		return
	}
	switch a.job.phase {
	case "to_counter":
		r.pickUp(a, now)
	case "picking":
		r.carry(a, now)
	case "carrying":
		r.deliver(a, now)
	case "to_table":
		r.startClearing(a, now)
	case "working":
		r.finishClearing(a, now)
	}
}

// findStaffWork assigns the most urgent job: a waiting customer first, then
// the oldest dirty table. Without work the employee steps out of the aisles.
func (r *room) findStaffWork(a *entity, now time.Time) {
	a.due = now.Add(staffIdleWait)
	if a.Role == gamerules.RoleWaiter && r.assignDelivery(a, now) {
		return
	}
	if r.assignTable(a, now) {
		return
	}
	r.stepAside(a, now)
}

func (r *room) assignDelivery(a *entity, now time.Time) bool {
	food, ok := r.availableFood()
	if !ok {
		return false
	}
	counter, ok := r.unit(food.CounterID)
	if !ok {
		return false
	}
	waiting := []*entity{}
	for _, c := range r.actors {
		if c.Kind == "npc" && c.State == "seated" && c.Food == nil && c.TableID != "" && c.servedBy == "" {
			waiting = append(waiting, c)
		}
	}
	if len(waiting) == 0 {
		return false
	}
	// The customer closest to giving up goes first.
	sort.Slice(waiting, func(i, j int) bool {
		pi, pj := waiting[i].patienceUntil, waiting[j].patienceUntil
		if pi.IsZero() != pj.IsZero() {
			return !pi.IsZero()
		}
		if !pi.Equal(pj) {
			return pi.Before(pj)
		}
		return waiting[i].ID < waiting[j].ID
	})
	customer := waiting[0]
	if !r.walkTo(a, counter, now) {
		return false
	}
	r.reserved[food.ID]++
	customer.servedBy = a.ID
	// The customer sees the waiter coming: the wait is paused until the hand-over.
	if !customer.patienceUntil.IsZero() {
		customer.pausedPatience = max(0, customer.patienceUntil.Sub(now))
		customer.clearPatience()
	}
	a.job = &staffJob{kind: "deliver", phase: "to_counter", customer: customer.ID, food: food, table: customer.TableID}
	r.broadcast(gamewire.Event{Type: "actors", Actors: []gamewire.Actor{r.status(customer, false)}}, "")
	return true
}

func (r *room) assignTable(a *entity, now time.Time) bool {
	dirt := append([]gamewire.Dirt{}, r.world.Dirt...)
	sort.Slice(dirt, func(i, j int) bool { return dirt[i].Since < dirt[j].Since })
	eating := map[string]bool{}
	for _, c := range r.actors {
		if c.Food != nil && c.Kind == "npc" {
			eating[c.TableID] = true
		}
	}
	for _, d := range dirt {
		if r.claimed[d.TableID] != "" || eating[d.TableID] {
			continue
		}
		table, ok := r.unit(d.TableID)
		if !ok || !r.walkTo(a, table, now) {
			continue
		}
		kind := "clean"
		if a.Role == gamerules.RoleWaiter {
			kind = "bus"
		}
		r.claimed[d.TableID] = a.ID
		a.job = &staffJob{kind: kind, phase: "to_table", table: d.TableID}
		return true
	}
	return false
}

// stepAside moves an idle employee off the tiles next to furniture, so
// customers can always reach their chairs.
func (r *room) stepAside(a *entity, now time.Time) {
	if !r.besideFurniture(Tile{X: a.X, Y: a.Y}) {
		return
	}
	best, bestPath := Tile{}, []Tile(nil)
	for y := 1; y < r.grid.height; y++ {
		for x := 1; x < r.grid.width; x++ {
			t := Tile{X: x, Y: y}
			if !r.grid.walkable(t) || r.occupied(t, a.ID) || r.besideFurniture(t) {
				continue
			}
			path := findPath(Tile{X: a.X, Y: a.Y}, t, func(t Tile) bool { return r.canWalk(t, a) }, r.grid.width*r.grid.height*4)
			if path != nil && (bestPath == nil || len(path) < len(bestPath)) {
				best, bestPath = t, path
			}
		}
	}
	if bestPath != nil {
		r.route(a, best, now)
	}
}

func (r *room) besideFurniture(t Tile) bool {
	for _, d := range []Tile{{X: 1}, {X: -1}, {Y: 1}, {Y: -1}} {
		for _, u := range r.grid.objects[Tile{X: t.X + d.X, Y: t.Y + d.Y}] {
			if item, _ := roomcatalog.ByID(u.ItemID); item.Kind == "chair" || item.Kind == "table" || item.Kind == "counter" || item.Kind == "stove" {
				return true
			}
		}
	}
	return false
}

func (r *room) customerFor(a *entity) *entity {
	if a.job == nil {
		return nil
	}
	c := r.actors[a.job.customer]
	if c == nil || c.servedBy != a.ID || c.State != "seated" || c.Food != nil {
		return nil
	}
	return c
}

func (r *room) pickUp(a *entity, now time.Time) {
	counter, ok := r.unit(a.job.food.CounterID)
	if !ok || r.customerFor(a) == nil || !r.foodExists(a.job.food.ID) {
		r.dropJob(a, now)
		return
	}
	if !r.beside(a, counter) {
		if !r.walkTo(a, counter, now) {
			r.dropJob(a, now)
		}
		return
	}
	r.startUnitAction(a, counter, "picking", now, gamerules.PickupDuration())
	a.job.phase = "picking"
}

func (r *room) carry(a *entity, now time.Time) {
	customer := r.customerFor(a)
	table, ok := r.unit(a.job.table)
	if customer == nil || !ok {
		r.dropJob(a, now)
		return
	}
	food := a.job.food
	food.Servings = 0
	food.CounterID = ""
	a.Food = &food
	a.Action = nil
	a.State = "carrying"
	a.job.phase = "carrying"
	if !r.beside(a, table) && !r.walkTo(a, table, now) {
		r.dropJob(a, now)
	}
}

func (r *room) deliver(a *entity, now time.Time) {
	customer := r.customerFor(a)
	table, ok := r.unit(a.job.table)
	if customer == nil || !ok {
		r.dropJob(a, now)
		return
	}
	if !r.beside(a, table) {
		if !r.walkTo(a, table, now) {
			r.dropJob(a, now)
		}
		return
	}
	a.Direction = direction(Tile{X: a.X, Y: a.Y}, Tile{X: table.X, Y: table.Y})
	foodID := a.job.food.ID
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	payment, err := r.manager.store.Consume(ctx, r.id, foodID, customer.TableID)
	cancel()
	r.release(foodID)
	if err != nil {
		if errors.Is(err, ErrFoodGone) {
			r.takeServing(foodID, 0)
			r.broadcast(gamewire.Event{Type: "food", Foods: r.world.Foods}, "")
		} else {
			log.Printf("waiter delivery failed: room=%s error=%v", r.id, err)
		}
		r.dropJob(a, now)
		return
	}
	customer.servedBy = ""
	customer.pausedPatience = 0
	r.startMeal(customer, a.job.food, payment, now)
	a.job = nil
	a.Food = nil
	a.State = "idle"
	a.due = now.Add(staffIdleWait / 2)
}

func (r *room) startClearing(a *entity, now time.Time) {
	table, ok := r.unit(a.job.table)
	if !ok || r.dirtOn(a.job.table) == nil {
		r.dropJob(a, now)
		return
	}
	if !r.beside(a, table) {
		if !r.walkTo(a, table, now) {
			r.dropJob(a, now)
		}
		return
	}
	kind, duration := "cleaning", gamerules.TableCleaning()
	if a.job.kind == "bus" {
		kind, duration = "busing", gamerules.BusDuration()
	}
	r.startUnitAction(a, table, kind, now, duration)
	a.job.phase = "working"
}

func (r *room) finishClearing(a *entity, now time.Time) {
	table := a.job.table
	if r.dirtOn(table) != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err := r.manager.store.Clean(ctx, r.id, table)
		cancel()
		if err != nil {
			log.Printf("staff cleaning failed: room=%s table=%s error=%v", r.id, table, err)
		} else {
			r.removeDirt(table)
		}
	}
	r.dropJob(a, now)
}

func (r *room) foodExists(id string) bool {
	for _, f := range r.world.Foods {
		if f.ID == id {
			return true
		}
	}
	return false
}

func (r *room) release(foodID string) {
	if r.reserved[foodID] > 1 {
		r.reserved[foodID]--
	} else {
		delete(r.reserved, foodID)
	}
}

// dropJob abandons the job: the serving goes back to the counter and the
// customer resumes the wait where it was paused (never less than 5 s).
func (r *room) dropJob(a *entity, now time.Time) {
	job := a.job
	a.job = nil
	a.Food = nil
	a.Action = nil
	if a.State != "idle" {
		a.State = "idle"
	}
	a.due = now.Add(staffIdleWait)
	if job == nil {
		return
	}
	switch job.kind {
	case "deliver":
		if job.phase == "to_counter" || job.phase == "picking" || job.phase == "carrying" {
			r.release(job.food.ID)
		}
		if c := r.actors[job.customer]; c != nil && c.servedBy == a.ID {
			c.servedBy = ""
			if c.State == "seated" && c.Food == nil {
				c.restorePatience(now.Add(max(5*time.Second, c.pausedPatience)))
				r.broadcast(gamewire.Event{Type: "actors", Actors: []gamewire.Actor{r.status(c, false)}}, "")
			}
			c.pausedPatience = 0
		}
	default:
		if r.claimed[job.table] == a.ID {
			delete(r.claimed, job.table)
		}
	}
}

// removeDirt mirrors a table cleared by staff in persistence.
func (r *room) removeDirt(tableID string) {
	dirt := r.world.Dirt[:0:0]
	for _, d := range r.world.Dirt {
		if d.TableID != tableID {
			dirt = append(dirt, d)
		}
	}
	r.world.Dirt = dirt
	r.broadcast(gamewire.Event{Type: "dirt", Dirt: r.world.Dirt}, "")
}

// dropAllJobs runs before the room sleeps: nothing half-done is saved.
func (r *room) dropAllJobs(now time.Time) {
	for _, a := range r.actors {
		if a.Kind == "staff" {
			r.dropJob(a, now)
		}
	}
}

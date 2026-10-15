// Package gameruntime owns the live room state. Only the room goroutine mutates it.
// Socket I/O and independent rooms run concurrently; no step writes to a database.
package gameruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/roomcatalog"
	"github.com/google/uuid"
)

type Storage interface {
	Load(context.Context, string) (gamewire.Seed, error)
	Active(context.Context, string, int) error
	Sleep(context.Context, string, gamewire.Sleep) error
	Operate(context.Context, gamewire.Operation) (gamewire.Result, error)
	// Consume takes one serving for a customer at a table and returns the payment
	// already credited to the owner; the same transaction leaves the table dirty.
	// waiter marks a staff delivery, which adds the customer's tip.
	Consume(ctx context.Context, room, food, table string, waiter bool) (gamewire.Payment, error)
	// Feedback records a customer verdict that came without a payment.
	Feedback(context.Context, string, bool) error
	// Clean clears a table's plates for the staff (no reward); an already
	// clean or missing table is not an error.
	Clean(ctx context.Context, room, table string) error
}
type Options struct {
	Tick, Step, Grace            time.Duration
	MaxRooms, MaxHumans, MaxNPCs int
}

func (o Options) defaults() Options {
	if o.Tick <= 0 {
		o.Tick = time.Second / 3
	}
	if o.Step <= 0 {
		o.Step = 2 * time.Second / 3
	}
	if o.Grace <= 0 {
		o.Grace = 30 * time.Second
	}
	if o.MaxRooms <= 0 {
		o.MaxRooms = 1024
	}
	if o.MaxHumans <= 0 {
		o.MaxHumans = 64
	}
	// Customers are also limited by dining seats; this caps large cafés.
	if o.MaxNPCs <= 0 {
		o.MaxNPCs = 6
	}
	return o
}

var ErrBusy = errors.New("fila do quarto ocupada; tente novamente")
var ErrClosed = errors.New("instância encerrada")

// ErrFoodGone means persistence no longer has the dish the room listed.
var ErrFoodGone = errors.New("prato indisponível")

type slot struct {
	ready chan struct{}
	room  *room
	err   error
}
type Manager struct {
	store    Storage
	options  Options
	mu       sync.Mutex
	rooms    map[string]*slot
	closing  bool
	closed   chan struct{}
	closeErr error
	wg       sync.WaitGroup
	steps    atomic.Uint64
	events   atomic.Uint64
}

func New(store Storage, options Options) *Manager {
	return &Manager{store: store, options: options.defaults(), rooms: map[string]*slot{}, closed: make(chan struct{})}
}

type Peer struct {
	ID     string
	Ticket gamewire.Ticket
	Out    chan []byte
	Kick   func()
	Closed atomic.Bool
}
type task struct {
	fn    func(*room) any
	reply chan any
}
type entity struct {
	gamewire.Actor
	path   []Tile
	due    time.Time
	visits int
	// Deadline for a seated customer waiting for food; zero otherwise.
	patienceUntil time.Time
	// Customer: the waiter bringing the dish, and the wait left when it was paused.
	servedBy       string
	pausedPatience time.Duration
	// Customer fetching a serving from the counter (self-service) until fetchAt.
	fetch   *gamewire.Food
	fetchAt time.Time
	// Consecutive seconds spent waiting for a blocked step (see waitBlocked).
	waits int
	// Staff: the job in progress, and since when it stands in the doorway.
	job          *staffJob
	doorwaySince time.Time
}
type room struct {
	manager       *Manager
	id, epoch     string
	world         gamewire.World
	grid          *grid
	seq           uint64
	actors        map[string]*entity
	peers         map[string]*Peer
	seats         map[string]string
	looks         []string
	tasks         chan task
	done          chan struct{}
	stop          chan struct{}
	idleAt        time.Time
	activated     bool
	spawnAt       time.Time
	lastPresence  time.Time
	occupancy     map[Tile]map[string]bool
	actorTiles    map[string][]Tile
	frozenAt      time.Time
	sleepRetry    time.Time
	sleepFailures int
	// Owner popularity in tenths, mirrored from persistence to pace arrivals.
	popularity int
	// Last kitchenIdle result, to notice the first dish going on the fire.
	kitchenWasIdle, kitchenKnown bool
	// Servings promised to waiters (food id → count) and tables taken by staff.
	reserved map[string]int
	// The owner's absence summary from the load, handed over on their welcome.
	away    *gamewire.AwaySummary
	claimed map[string]string
}

func (m *Manager) get(ctx context.Context, id string) (*room, error) {
	m.mu.Lock()
	if m.closing {
		m.mu.Unlock()
		return nil, ErrClosed
	}
	s, ok := m.rooms[id]
	if !ok {
		if len(m.rooms) >= m.options.MaxRooms {
			m.mu.Unlock()
			return nil, ErrBusy
		}
		s = &slot{ready: make(chan struct{})}
		m.rooms[id] = s
		m.wg.Add(1)
		m.mu.Unlock()
		loadCtx, loadCancel := context.WithTimeout(ctx, 8*time.Second)
		seed, err := m.store.Load(loadCtx, id)
		loadCancel()
		if err == nil && (seed.World.TilesX < 2 || seed.World.TilesY < 2 || seed.World.TilesX > 40 || seed.World.TilesY > 40 || len(seed.World.Units) > 4000) {
			err = errors.New("mapa inválido")
		}
		m.mu.Lock()
		s.err = err
		if err != nil {
			delete(m.rooms, id)
			m.wg.Done()
		} else {
			r := &room{manager: m, id: id, epoch: uuid.NewString(), world: seed.World, grid: newGrid(seed.World), actors: map[string]*entity{}, peers: map[string]*Peer{}, seats: map[string]string{}, looks: seed.Looks, tasks: make(chan task, 256), done: make(chan struct{}), stop: make(chan struct{}), idleAt: time.Now(), spawnAt: time.Now().Add(time.Second)}
			r.popularity = seed.PopularityTenths
			r.away = seed.Away
			if low, _ := gamerules.PopularityBoundsTenths(); r.popularity < low {
				r.popularity = low
			}
			r.occupancy = map[Tile]map[string]bool{}
			r.actorTiles = map[string][]Tile{}
			r.reserved = map[string]int{}
			r.claimed = map[string]string{}
			r.frozenAt = time.Now()
			for _, a := range seed.NPCs {
				if len(r.actors) >= m.options.MaxNPCs {
					break
				}
				a.Kind = "npc"
				a.Move = nil
				if a.Action != nil {
					action := *a.Action
					action.StartedAt = r.frozenAt.UnixMilli() + a.ActionRemaining - action.Duration
					a.Action = &action
				}
				r.actors[a.ID] = &entity{Actor: a, path: a.Path, due: r.frozenAt.Add(time.Duration(a.ActionRemaining) * time.Millisecond), visits: a.Visits}
				r.actors[a.ID].Path = nil
				if a.Patience != nil {
					r.actors[a.ID].restorePatience(r.frozenAt.Add(time.Duration(a.PatienceRemaining) * time.Millisecond))
				}
				r.actors[a.ID].PatienceRemaining = 0
				if a.ChairID != "" {
					r.seats[a.ChairID] = a.ID
				}
				r.indexActor(r.actors[a.ID])
			}
			r.syncStaff(r.frozenAt)
			s.room = r
			go r.run()
		}
		close(s.ready)
		m.mu.Unlock()
	} else {
		m.mu.Unlock()
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.ready:
		return s.room, s.err
	}
}
func (r *room) call(ctx context.Context, fn func(*room) any) (any, error) {
	t := task{fn, make(chan any, 1)}
	select {
	case <-r.done:
		return nil, ErrClosed
	default:
	}
	select {
	case r.tasks <- t:
	default:
		return nil, ErrBusy
	}
	select {
	case result := <-t.reply:
		return result, nil
	case <-r.done:
		return nil, ErrClosed
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
func (m *Manager) call(ctx context.Context, id string, fn func(*room) any) (any, error) {
	for i := 0; i < 2; i++ {
		r, err := m.get(ctx, id)
		if err != nil {
			return nil, err
		}
		value, err := r.call(ctx, fn)
		if !errors.Is(err, ErrClosed) {
			return value, err
		}
	}
	return nil, ErrClosed
}
func (m *Manager) Join(ctx context.Context, p *Peer) error {
	v, err := m.call(ctx, p.Ticket.Room, func(r *room) any { return r.join(p) })
	if err != nil {
		return err
	}
	if v != nil {
		return v.(error)
	}
	return nil
}
func (m *Manager) Leave(ctx context.Context, p *Peer) {
	m.mu.Lock()
	s := m.rooms[p.Ticket.Room]
	m.mu.Unlock()
	if s == nil {
		return
	}
	select {
	case <-s.ready:
	default:
		return
	}
	if s.room != nil {
		_, _ = s.room.call(ctx, func(r *room) any { r.leave(p.ID); return nil })
	}
}
func (m *Manager) Command(ctx context.Context, p *Peer, c gamewire.Command) error {
	m.mu.Lock()
	s := m.rooms[p.Ticket.Room]
	m.mu.Unlock()
	if s == nil {
		return ErrClosed
	}
	select {
	case <-s.ready:
	case <-ctx.Done():
		return ctx.Err()
	}
	_, err := s.room.call(ctx, func(r *room) any {
		if r.peers[p.ID] == p {
			r.command(p, c)
		}
		return nil
	})
	return err
}
func (m *Manager) Operate(ctx context.Context, op gamewire.Operation) (gamewire.Result, error) {
	v, err := m.call(ctx, op.Owner, func(r *room) any {
		// A visitor in the café may season a friend's stove; nothing else.
		if op.User != op.Owner && op.Action != "cook_season" {
			return gamewire.Result{Status: 403, Body: json.RawMessage(`{"message":"Somente o dono pode alterar o quarto."}`)}
		}
		if message := r.validateOperation(op); message != "" {
			body, _ := json.Marshal(map[string]string{"message": message})
			return gamewire.Result{Status: 409, Body: body}
		}
		ioCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		result, err := m.store.Operate(ioCtx, op)
		if err != nil {
			return err
		}
		if result.Status >= 200 && result.Status < 300 && result.World != nil {
			// The cleaning pose goes out before the cleared table, so clients keep
			// the plates until the brush is done.
			if op.Action == "table_clean" {
				var body struct {
					TableID string `json:"tableId"`
				}
				_ = json.Unmarshal(op.Body, &body)
				if a := r.actors["human:"+op.User]; a != nil {
					if table, ok := r.adjacentUnit(a, body.TableID, "table"); ok {
						r.startUnitAction(a, table, "cleaning", time.Now(), gamerules.TableCleaning())
						r.broadcast(gamewire.Event{Type: "actors", Actors: []gamewire.Actor{r.status(a, false)}}, "")
					}
				}
			}
			r.updateWorld(*result.World)
			if op.Action == "cook_start" {
				if a := r.actors["human:"+op.User]; a != nil {
					var body struct {
						StoveID string `json:"stoveId"`
					}
					_ = json.Unmarshal(op.Body, &body)
					r.startCookingAction(a, body.StoveID, time.Now())
					r.broadcast(gamewire.Event{Type: "actors", Actors: []gamewire.Actor{r.status(a, false)}}, "")
				}
			}
			if op.Action == "cook_serve" || op.Action == "cook_cancel" {
				var body struct {
					StoveID string `json:"stoveId"`
				}
				_ = json.Unmarshal(op.Body, &body)
				if a := r.actors["human:"+op.User]; a != nil && a.Action != nil && a.Action.StoveID == body.StoveID {
					a.State = "idle"
					a.Action = nil
					r.broadcast(gamewire.Event{Type: "actors", Actors: []gamewire.Actor{r.status(a, false)}}, "")
				}
			}
		}
		return result
	})
	if err != nil {
		return gamewire.Result{}, err
	}
	if e, ok := v.(error); ok {
		return gamewire.Result{}, e
	}
	return v.(gamewire.Result), nil
}
func (m *Manager) Appearance(ctx context.Context, user, value string) {
	m.mu.Lock()
	list := []*room{}
	for _, s := range m.rooms {
		select {
		case <-s.ready:
			if s.room != nil {
				list = append(list, s.room)
			}
		default:
		}
	}
	m.mu.Unlock()
	for _, r := range list {
		_, _ = r.call(ctx, func(r *room) any {
			if a := r.actors["human:"+user]; a != nil {
				a.Appearance = value
				r.broadcast(gamewire.Event{Type: "actors", Actors: []gamewire.Actor{r.status(a, true)}}, "")
			}
			return nil
		})
	}
}
func (m *Manager) Kick(ctx context.Context, user string) {
	m.mu.Lock()
	list := []*room{}
	for _, s := range m.rooms {
		select {
		case <-s.ready:
			if s.room != nil {
				list = append(list, s.room)
			}
		default:
		}
	}
	m.mu.Unlock()
	for _, r := range list {
		_, _ = r.call(ctx, func(r *room) any {
			for id, p := range r.peers {
				if p.Ticket.User == user {
					p.Kick()
					r.leave(id)
				}
			}
			return nil
		})
	}
}
func (m *Manager) Close(ctx context.Context) error {
	m.mu.Lock()
	if !m.closing {
		m.closing = true
		list := make([]*slot, 0, len(m.rooms))
		for _, s := range m.rooms {
			list = append(list, s)
		}
		go func() {
			for _, s := range list {
				<-s.ready
				if s.room != nil {
					close(s.room.stop)
				}
			}
			m.wg.Wait()
			close(m.closed)
		}()
	}
	m.mu.Unlock()
	select {
	case <-m.closed:
		m.mu.Lock()
		defer m.mu.Unlock()
		return m.closeErr
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (m *Manager) Stats() map[string]any {
	m.mu.Lock()
	n := len(m.rooms)
	m.mu.Unlock()
	return map[string]any{"rooms": n, "steps": m.steps.Load(), "events": m.events.Load()}
}
func (r *room) run() {
	ticker := time.NewTicker(r.manager.options.Tick)
	defer ticker.Stop()
	stepTimer := time.NewTimer(time.Hour)
	defer stepTimer.Stop()
	var lastTick time.Time
	defer func() {
		close(r.done)
		r.manager.mu.Lock()
		if s := r.manager.rooms[r.id]; s != nil && s.room == r {
			delete(r.manager.rooms, r.id)
		}
		r.manager.mu.Unlock()
		r.manager.wg.Done()
	}()
	for {
		if !stepTimer.Stop() {
			select {
			case <-stepTimer.C:
			default:
			}
		}
		wait := time.Hour
		if len(r.peers) > 0 || r.activated && time.Since(r.idleAt) < r.manager.options.Grace {
			for _, a := range r.actors {
				if a.Move != nil {
					until := time.Until(time.UnixMilli(a.Move.StartedAt + a.Move.Duration))
					if until < wait {
						wait = max(time.Millisecond, until)
					}
				}
			}
		}
		stepTimer.Reset(wait)
		select {
		case t := <-r.tasks:
			t.reply <- t.fn(r)
		case now := <-ticker.C:
			// A room still frozen for its sleep shifts on join instead.
			if pause := frozenFor(lastTick, now, r.manager.options.Tick); pause > 0 && r.frozenAt.IsZero() {
				r.shiftClocks(pause)
			}
			lastTick = now
			for id, p := range r.peers {
				if p.Closed.Load() {
					r.leave(id)
				}
			}
			if r.activated && now.Sub(r.lastPresence) >= 15*time.Second && (len(r.peers) > 0 || now.Sub(r.idleAt) < r.manager.options.Grace) {
				r.presence()
			}
			if len(r.peers) > 0 || r.activated && now.Sub(r.idleAt) < r.manager.options.Grace {
				r.tick(now)
			}
			if len(r.peers) == 0 && now.Sub(r.idleAt) >= r.manager.options.Grace && !now.Before(r.sleepRetry) {
				if r.sleep(now) == nil {
					return
				}
			}
		case now := <-stepTimer.C:
			if len(r.peers) > 0 || r.activated && now.Sub(r.idleAt) < r.manager.options.Grace {
				r.tick(now)
			}
		case <-r.stop:
			for _, p := range r.peers {
				p.Kick()
			}
			var err error
			for attempt := 0; attempt < 3; attempt++ {
				if err = r.sleep(time.Now()); err == nil {
					break
				}
				if attempt < 2 {
					time.Sleep(time.Duration(attempt+1) * 300 * time.Millisecond)
				}
			}
			if err != nil {
				r.manager.mu.Lock()
				r.manager.closeErr = errors.Join(r.manager.closeErr, fmt.Errorf("save room %s: %w", r.id, err))
				r.manager.mu.Unlock()
			}
			return
		}
	}
}
func (r *room) sleep(now time.Time) error {
	if r.frozenAt.IsZero() {
		r.frozenAt = now
	}
	// Jobs in progress are dropped first: promised servings go back to the
	// counters and served customers resume their saved wait.
	r.dropAllJobs(now)
	r.dropFetches(now)
	npcs := []gamewire.Actor{}
	for _, a := range r.actors {
		if a.Kind != "npc" {
			continue
		}
		state := r.status(a, true)
		state.Move = nil
		if a.Move != nil {
			state.X = a.Move.From.X
			state.Y = a.Move.From.Y
			state.Path = append([]Tile{a.Move.To}, a.path...)
		} else {
			state.Path = append([]Tile{}, a.path...)
		}
		state.ActionRemaining = max(0, a.due.Sub(r.frozenAt).Milliseconds())
		state.Visits = a.visits
		if !a.patienceUntil.IsZero() {
			state.PatienceRemaining = max(1, a.patienceUntil.Sub(r.frozenAt).Milliseconds())
		}
		npcs = append(npcs, state)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	err := r.manager.store.Sleep(ctx, r.id, gamewire.Sleep{NPCs: npcs})
	// A failed save keeps the room and final state for retry, without continuing simulation.
	if err != nil {
		r.sleepFailures++
		r.sleepRetry = time.Now().Add(time.Duration(min(r.sleepFailures, 6)) * 5 * time.Second)
		log.Printf("room save will retry: room=%s error=%v", r.id, err)
		return err
	}
	return nil
}
func (r *room) join(p *Peer) error {
	if len(r.peers) >= r.manager.options.MaxHumans*2 {
		return ErrBusy
	}
	id := "human:" + p.Ticket.User
	a := r.actors[id]
	if a == nil {
		humans := 0
		for _, v := range r.actors {
			if v.Kind == "human" {
				humans++
			}
		}
		if humans >= r.manager.options.MaxHumans {
			return ErrBusy
		}
		tile, ok := r.freeTile(Tile{X: 4, Y: 4}, "")
		if !ok {
			return errors.New("quarto sem espaço livre")
		}
		a = &entity{Actor: gamewire.Actor{ID: id, Kind: "human", Name: p.Ticket.Name, Appearance: p.Ticket.Appearance, X: tile.X, Y: tile.Y, State: "idle"}}
	}
	if r.actors[id] == nil || !r.activated {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		count := 0
		for _, actor := range r.actors {
			if actor.Kind == "human" {
				count++
			}
		}
		if r.actors[id] == nil {
			count++
		}
		err := r.manager.store.Active(ctx, r.id, count)
		cancel()
		if err != nil {
			return err
		}
		r.activated = true
		r.lastPresence = time.Now()
	}
	if !r.frozenAt.IsZero() {
		r.shiftClocks(time.Since(r.frozenAt))
		r.frozenAt = time.Time{}
		r.sleepRetry = time.Time{}
		r.sleepFailures = 0
	}
	a.Name = p.Ticket.Name
	a.Appearance = p.Ticket.Appearance
	r.actors[id] = a
	r.peers[p.ID] = p
	r.indexActor(a)
	r.broadcast(gamewire.Event{Type: "actors", Actors: []gamewire.Actor{r.status(a, true)}}, p.ID)
	actors := make([]gamewire.Actor, 0, len(r.actors))
	for _, v := range r.actors {
		actors = append(actors, r.status(v, true))
	}
	welcome := gamewire.Event{Type: "welcome", SelfID: id, World: &r.world, Actors: actors}
	// The owner hears once what the café did while they were away (the room id is the owner's).
	if p.Ticket.User == r.id && r.away != nil {
		welcome.Away, r.away = r.away, nil
	}
	r.send(p, welcome)
	return nil
}

// shiftClocks moves every running timer forward by a pause, so time the room
// did not run (asleep, or a frozen process) does not expire it all at once.
func (r *room) shiftClocks(pause time.Duration) {
	if pause <= 0 {
		return
	}
	for _, a := range r.actors {
		a.due = a.due.Add(pause)
		if a.Action != nil {
			a.Action.StartedAt += pause.Milliseconds()
		}
		if a.Move != nil {
			a.Move.StartedAt += pause.Milliseconds()
		}
		if !a.patienceUntil.IsZero() {
			a.restorePatience(a.patienceUntil.Add(pause))
		}
		if !a.fetchAt.IsZero() {
			a.fetchAt = a.fetchAt.Add(pause)
		}
		if !a.doorwaySince.IsZero() {
			a.doorwaySince = a.doorwaySince.Add(pause)
		}
	}
	r.spawnAt = r.spawnAt.Add(pause)
}

// freezeGap: ticks this much later than due mean the process was frozen
// (a laptop asleep, a debugger), not merely busy.
const freezeGap = 5 * time.Second

// frozenFor is how long the room was frozen between two ticks, if at all.
func frozenFor(last, now time.Time, tick time.Duration) time.Duration {
	if last.IsZero() {
		return 0
	}
	if gap := now.Sub(last) - tick; gap > freezeGap {
		return gap
	}
	return 0
}

func (r *room) leave(id string) {
	p := r.peers[id]
	if p == nil {
		return
	}
	delete(r.peers, id)
	actorID := "human:" + p.Ticket.User
	for _, other := range r.peers {
		if other.Ticket.User == p.Ticket.User {
			return
		}
	}
	if a := r.actors[actorID]; a != nil {
		r.releaseSeat(a)
		delete(r.actors, actorID)
		r.unindexActor(actorID)
		r.broadcast(gamewire.Event{Type: "actors", Removed: []string{actorID}}, "")
	}
	if len(r.peers) == 0 {
		r.idleAt = time.Now()
	}
	r.presence()
}
func (r *room) presence() {
	r.lastPresence = time.Now()
	count := 0
	for _, a := range r.actors {
		if a.Kind == "human" {
			count++
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := r.manager.store.Active(ctx, r.id, count); err != nil {
		log.Printf("room presence renewal failed: room=%s error=%v", r.id, err)
	}
}
func (r *room) status(a *entity, identity bool) gamewire.Actor {
	v := a.Actor
	v.Path = nil
	v.Visits = 0
	v.PatienceRemaining = 0
	v.ActionRemaining = max(0, time.Until(a.due).Milliseconds())
	if !identity {
		v.Kind = ""
		v.Name = ""
		v.Appearance = ""
	}
	return v
}
func (r *room) envelope(e gamewire.Event) gamewire.Event {
	e.Epoch = r.epoch
	e.Seq = r.seq
	e.ServerNow = time.Now().UnixMilli()
	return e
}
func (r *room) send(p *Peer, e gamewire.Event) {
	data, _ := json.Marshal(r.envelope(e))
	select {
	case p.Out <- data:
	default:
		p.Kick()
	}
}
func (r *room) broadcast(e gamewire.Event, except string) {
	r.seq++
	r.manager.events.Add(1)
	data, _ := json.Marshal(r.envelope(e))
	for id, p := range r.peers {
		if id == except {
			continue
		}
		select {
		case p.Out <- data:
		default:
			p.Kick()
		}
	}
}
func (r *room) occupied(t Tile, except string) bool {
	for id := range r.occupancy[t] {
		if id != except {
			return true
		}
	}
	return false
}
func (r *room) unindexActor(id string) {
	for _, t := range r.actorTiles[id] {
		delete(r.occupancy[t], id)
	}
	delete(r.actorTiles, id)
}
func (r *room) indexActor(a *entity) {
	previous := r.actorTiles[a.ID]
	r.unindexActor(a.ID)
	r.actorTiles[a.ID] = previous[:0]
	tiles := []Tile{{X: a.X, Y: a.Y}}
	if a.Move != nil {
		tiles = append(tiles, a.Move.From, a.Move.To)
	}
	for _, t := range tiles {
		if t.X < 1 || t.Y < 1 {
			continue
		}
		if r.occupancy[t] == nil {
			r.occupancy[t] = map[string]bool{}
		}
		r.occupancy[t][a.ID] = true
		r.actorTiles[a.ID] = append(r.actorTiles[a.ID], t)
	}
}
func (r *room) canWalk(t Tile, a *entity) bool {
	if !r.grid.inside(t) {
		return false
	}
	if r.occupied(t, a.ID) {
		return false
	}
	if r.grid.walkable(t) {
		return true
	}
	if a.ChairID != "" {
		for _, u := range r.grid.objects[t] {
			if u.ID == a.ChairID && r.seats[u.ID] == a.ID {
				return true
			}
		}
	}
	return false
}
func (r *room) freeTile(preferred Tile, except string) (Tile, bool) {
	if r.grid.walkable(preferred) && !r.occupied(preferred, except) {
		return preferred, true
	}
	for y := 1; y < r.grid.height; y++ {
		for x := 1; x < r.grid.width; x++ {
			t := Tile{X: x, Y: y}
			if r.grid.walkable(t) && !r.occupied(t, except) {
				return t, true
			}
		}
	}
	return Tile{}, false
}
func (r *room) releaseSeat(a *entity) {
	if a.ChairID != "" && r.seats[a.ChairID] == a.ID {
		delete(r.seats, a.ChairID)
	}
	if a.fetch != nil {
		r.release(a.fetch.ID)
		a.fetch = nil
	}
	a.ChairID = ""
	a.TableID = ""
	a.Food = nil
}
func (r *room) route(a *entity, dest Tile, now time.Time) bool {
	start := Tile{X: a.X, Y: a.Y}
	if a.Move != nil {
		start = a.Move.To
	}
	path := findPath(start, dest, func(t Tile) bool { return r.canWalk(t, a) }, r.grid.width*r.grid.height*4)
	if path == nil {
		return false
	}
	a.path = path
	a.waits = 0
	if a.Move == nil {
		r.nextStep(a, now)
	}
	return true
}
func (r *room) nextStep(a *entity, now time.Time) bool {
	if len(a.path) == 0 {
		return false
	}
	dest := a.path[0]
	from := Tile{X: a.X, Y: a.Y}
	if abs(dest.X-from.X) > 1 || abs(dest.Y-from.Y) > 1 || dest == from {
		a.path = nil
		return false
	}
	external := a.Kind == "npc" && a.Outside && (dest.X <= 0 || dest.Y <= 0)
	if !external && !r.canWalk(dest, a) {
		alternative := findPath(from, a.path[len(a.path)-1], func(t Tile) bool { return r.canWalk(t, a) }, r.grid.width*r.grid.height*4)
		if len(alternative) == 0 {
			// Customers wait for the tile to clear. Players and staff give up
			// after blockedRetries: an employee waiting forever would still
			// look free to nearestIdle and keep the others from working.
			if a.Kind == "npc" {
				a.due = now.Add(time.Second)
				return false
			}
			return r.waitBlocked(a, now)
		}
		a.path = alternative
		dest = alternative[0]
	}
	// A diagonal step whose two sides got occupied after planning would cut
	// through someone: plan around them (findPath never cuts such a corner),
	// or wait for the corner to clear before giving up.
	if !external && dest.X != from.X && dest.Y != from.Y && !r.canWalk(Tile{X: dest.X, Y: from.Y}, a) && !r.canWalk(Tile{X: from.X, Y: dest.Y}, a) {
		alternative := findPath(from, a.path[len(a.path)-1], func(t Tile) bool { return r.canWalk(t, a) }, r.grid.width*r.grid.height*4)
		if len(alternative) == 0 {
			return r.waitBlocked(a, now)
		}
		a.path = alternative
		dest = alternative[0]
	}
	a.waits = 0
	a.path = a.path[1:]
	a.Direction = direction(from, dest)
	a.Move = &gamewire.Movement{From: from, To: dest, StartedAt: now.UnixMilli(), Duration: r.manager.options.Step.Milliseconds()}
	r.indexActor(a)
	r.manager.steps.Add(1)
	return true
}

// blockedRetries is how many one-second waits an actor spends on a blocked
// corner before dropping its path; its state machine then picks a new goal,
// so two actors never wait on each other forever.
const blockedRetries = 3

// standStill drops a player's walk that is only waiting on a blocked step:
// an action asked from where they stand replaces it, so the adjacency checks
// see a standing player and the old walk does not resume afterwards.
func standStill(a *entity) {
	if a != nil && a.Move == nil && a.waits > 0 {
		a.path = nil
		a.waits = 0
	}
}

func (r *room) waitBlocked(a *entity, now time.Time) bool {
	if a.waits >= blockedRetries {
		a.waits = 0
		a.path = nil
		return false
	}
	a.waits++
	a.due = now.Add(time.Second)
	return false
}

func (r *room) command(p *Peer, c gamewire.Command) {
	a := r.actors["human:"+p.Ticket.User]
	if a == nil {
		return
	}
	fail := func(message string) {
		r.send(p, gamewire.Event{Type: "error", RequestID: c.RequestID, Message: message})
	}
	if busyState(a.State) && time.Now().Before(a.due) {
		if c.Type == "serve_prepare" && a.State == "serving" && a.Action != nil && a.Action.StoveID == c.StoveID {
			r.send(p, gamewire.Event{Type: "ack", RequestID: c.RequestID})
			return
		}
		if a.State == "cleaning" {
			fail("Aguarde terminar a limpeza.")
		} else {
			fail("Aguarde o preparo.")
		}
		return
	}
	now := time.Now()
	switch c.Type {
	case "walk":
		if c.X == nil || c.Y == nil || *c.X < 1 || *c.Y < 1 || *c.X >= r.grid.width || *c.Y >= r.grid.height {
			fail("Destino inválido.")
			return
		}
		dest := Tile{X: *c.X, Y: *c.Y}
		if !r.grid.walkable(dest) || r.occupied(dest, a.ID) {
			fail("Destino ocupado.")
			return
		}
		oldChair := a.ChairID
		a.ChairID = ""
		if !r.route(a, dest, now) {
			a.ChairID = oldChair
			fail("Não há caminho livre.")
			return
		}
		if oldChair != "" {
			delete(r.seats, oldChair)
		}
		a.TableID = ""
		a.Food = nil
		a.State = "idle"
	case "sit":
		if !r.reserveChair(a, c.ChairID, now) {
			fail("Cadeira ocupada ou inacessível.")
			return
		}
	case "stand":
		dest, ok := r.freeNeighbour(Tile{X: a.X, Y: a.Y}, a)
		if !ok || !r.route(a, dest, now) {
			fail("Não há espaço para levantar.")
			return
		}
		r.releaseSeat(a)
		a.State = "idle"
	case "serve_prepare":
		if p.Ticket.User != r.id {
			fail("Somente o dono pode servir.")
			return
		}
		standStill(a)
		if message := r.startServingAction(a, c.StoveID, now); message != "" {
			fail(message)
			return
		}
	default:
		fail("Comando desconhecido.")
		return
	}
	if c.Type == "walk" || c.Type == "stand" {
		a.Action = nil
	}
	r.broadcast(gamewire.Event{Type: "actors", Actors: []gamewire.Actor{r.status(a, false)}}, "")
	r.send(p, gamewire.Event{Type: "ack", RequestID: c.RequestID})
}
func (r *room) freeNeighbour(t Tile, a *entity) (Tile, bool) {
	for _, d := range neighbours {
		n := Tile{X: t.X + d.X, Y: t.Y + d.Y}
		if r.grid.walkable(n) && !r.occupied(n, a.ID) {
			return n, true
		}
	}
	return Tile{}, false
}
func (r *room) reserveChair(a *entity, id string, now time.Time) bool {
	var chair Unit
	found := false
	for _, u := range r.world.Units {
		it, _ := roomcatalog.ByID(u.ItemID)
		if u.ID == id && it.Kind == "chair" {
			chair = u
			found = true
			break
		}
	}
	if !found || r.seats[id] != "" && r.seats[id] != a.ID {
		return false
	}
	oldChair, oldTable := a.ChairID, a.TableID
	r.seats[id] = a.ID
	a.ChairID = id
	a.TableID = ""
	d := []Tile{{X: 1, Y: 0}, {X: 0, Y: 1}, {X: -1, Y: 0}, {X: 0, Y: -1}}[chair.Rotation%4]
	for _, u := range r.grid.objects[Tile{X: chair.X + d.X, Y: chair.Y + d.Y}] {
		it, _ := roomcatalog.ByID(u.ItemID)
		if it.Kind == "table" {
			a.TableID = u.ID
			break
		}
	}
	if !r.route(a, Tile{X: chair.X, Y: chair.Y}, now) {
		if oldChair != id {
			delete(r.seats, id)
		}
		a.ChairID = oldChair
		a.TableID = oldTable
		return false
	}
	if oldChair != "" && oldChair != id {
		delete(r.seats, oldChair)
	}
	a.Action = nil
	a.State = "to_seat"
	if a.Move == nil && len(a.path) == 0 {
		r.sit(a, now)
	}
	return true
}
func (r *room) sit(a *entity, now time.Time) {
	a.State = "seated"
	a.due = now.Add(2 * time.Second)
	a.Action = &gamewire.ActorAction{Kind: "seated", StartedAt: now.UnixMilli(), Duration: 2000}
	if a.Kind == "npc" {
		a.restorePatience(now.Add(gamerules.CustomerPatience()))
	}
	for _, u := range r.world.Units {
		if u.ID == a.ChairID {
			a.Direction = []int{1, 7, 5, 3}[u.Rotation%4]
		}
	}
}
func (r *room) validateOperation(op gamewire.Operation) string {
	var body struct {
		UnitID   string `json:"unitId"`
		ItemID   int    `json:"itemId"`
		StoveID  string `json:"stoveId"`
		X        *int   `json:"tx"`
		Y        *int   `json:"ty"`
		Rotation *int   `json:"rotation"`
	}
	if json.Unmarshal(op.Body, &body) != nil {
		return "Pedido inválido."
	}
	standStill(r.actors["human:"+op.User])
	if op.Action == "move" || op.Action == "store" || op.Action == "purchase" {
		var item roomcatalog.Item
		if op.Action == "purchase" {
			item, _ = roomcatalog.ByID(body.ItemID)
		} else {
			for _, u := range r.world.Units {
				if u.ID == body.UnitID {
					item, _ = roomcatalog.ByID(u.ItemID)
					break
				}
			}
		}
		if r.seats[body.UnitID] != "" {
			return "Esta cadeira está ocupada ou reservada."
		}
		for _, a := range r.actors {
			if body.UnitID != "" && a.TableID == body.UnitID {
				return "Esta mesa está em uso."
			}
		}
		if item.Kind == "door" {
			var door Unit
			for _, u := range r.world.Units {
				if u.ID == body.UnitID {
					door = u
					break
				}
			}
			for _, a := range r.actors {
				nearDoor := door.ID != "" && abs(a.X-door.X)+abs(a.Y-door.Y) <= 2
				if a.Kind == "npc" && nearDoor && (a.State == "entering" || a.State == "leaving") {
					return "Aguarde o cliente atravessar a porta."
				}
			}
		}
		if op.Action != "store" && item.Type >= 2 && item.Kind != "wall" && item.Kind != "window" && item.Kind != "panel" && body.X != nil && body.Y != nil && body.Rotation != nil {
			u := Unit{ItemID: item.ID, X: *body.X, Y: *body.Y, Rotation: *body.Rotation}
			for _, t := range footprint(u) {
				if r.occupied(t, "") {
					return "Há um personagem nesta posição."
				}
			}
		}
	}
	if op.Action == "cook_start" || op.Action == "cook_serve" {
		a := r.actors["human:"+op.User]
		if _, ok := r.adjacentStove(a, body.StoveID); !ok {
			return "Aproxime seu personagem do fogão."
		}
		if a.Action != nil && time.Now().Before(a.due) {
			return "Aguarde o preparo."
		}
	}
	if op.Action == "table_clean" {
		var target struct {
			TableID string `json:"tableId"`
		}
		_ = json.Unmarshal(op.Body, &target)
		a := r.actors["human:"+op.User]
		if a != nil && a.Action != nil && time.Now().Before(a.due) {
			return "Aguarde terminar a ação."
		}
		if _, ok := r.adjacentUnit(a, target.TableID, "table"); !ok {
			return "Aproxime seu personagem da mesa."
		}
		if r.dirtOn(target.TableID) == nil {
			return "A mesa já está limpa."
		}
	}
	if op.Action == "cook_season" && r.actors["human:"+op.User] == nil {
		return "Entre no café para temperar."
	}
	return ""
}
func (r *room) updateWorld(w gamewire.World) {
	old := map[string]Unit{}
	for _, u := range r.world.Units {
		old[u.ID] = u
	}
	changes := []Unit{}
	for _, u := range w.Units {
		previous, ok := old[u.ID]
		delete(old, u.ID)
		if !ok || previous != u {
			if ok {
				r.grid.remove(previous)
			}
			r.grid.add(u)
			changes = append(changes, u)
		}
	}
	for _, u := range old {
		r.grid.remove(u)
		u.Placed = false
		changes = append(changes, u)
	}
	cookingChanged := string(w.Cooking) != string(r.world.Cooking)
	foodsChanged := fmt.Sprint(w.Foods) != fmt.Sprint(r.world.Foods)
	dirtChanged := fmt.Sprint(w.Dirt) != fmt.Sprint(r.world.Dirt)
	streetChanged := fmt.Sprint(w.Street) != fmt.Sprint(r.world.Street)
	// An expansion only grows the room towards the front (walls stay on tx=0
	// and ty=0), so every actor and path stays valid; the grid is rebuilt
	// for the new bounds and the next world event carries them.
	resized := w.TilesX != r.world.TilesX || w.TilesY != r.world.TilesY
	r.world = w
	if resized {
		r.grid = newGrid(w)
	}
	r.syncStaff(time.Now())
	doorChanged := false
	for _, u := range changes {
		if item, _ := roomcatalog.ByID(u.ItemID); item.Kind == "door" {
			doorChanged = true
		}
	}
	if doorChanged {
		now := time.Now()
		for _, a := range r.actors {
			if a.Kind != "npc" {
				continue
			}
			if a.State == "entering" && a.Outside {
				start := Tile{X: a.X, Y: a.Y}
				if a.Move != nil {
					start = a.Move.To
				}
				if start.X > 0 && start.Y > 0 {
					continue
				}
				if door, ok := r.grid.door(); ok {
					entry, turn := opening(door), opening(door)
					if entry.X == 0 {
						turn.X = -1
					} else {
						turn.Y = -1
					}
					a.path = append(streetLine(start, turn), line(turn, entry)...)
					a.path = append(a.path, Tile{X: door.X, Y: door.Y})
				} else {
					a.State = "leaving"
					a.path = streetLine(start, Tile{X: -1, Y: r.grid.height + 8})
				}
			} else if a.State == "leaving" && !a.Outside {
				r.exitNPC(a, now)
			}
		}
	}
	if len(changes) > 0 || cookingChanged || resized || streetChanged {
		e := gamewire.Event{Type: "world", Units: changes, Revision: w.Revision}
		if cookingChanged {
			e.Cooking = w.Cooking
		}
		if resized {
			e.TilesX, e.TilesY = w.TilesX, w.TilesY
		}
		if streetChanged {
			e.Street = w.Street
		}
		r.broadcast(e, "")
	}
	// A food event always carries the complete list; an absent field means none left.
	if foodsChanged {
		r.broadcast(gamewire.Event{Type: "food", Foods: w.Foods}, "")
	}
	// Same contract as food: the complete list, absent meaning every table is clean.
	if dirtChanged {
		r.broadcast(gamewire.Event{Type: "dirt", Dirt: w.Dirt}, "")
	}
}
func (r *room) tick(now time.Time) {
	r.watchKitchen(now)
	updates := []gamewire.Actor{}
	removed := []string{}
	for _, a := range r.actors {
		changed := false
		if a.Emotion != nil && now.UnixMilli() >= a.Emotion.StartedAt+a.Emotion.Duration {
			a.Emotion = nil
			changed = true
		}
		if a.Move != nil {
			elapsed := now.UnixMilli() - a.Move.StartedAt
			// Keep the nearest-tile transition at 50%, including odd durations:
			// integer truncation must not put the server ahead of the renderer.
			if elapsed >= (a.Move.Duration+1)/2 {
				a.X = a.Move.To.X
				a.Y = a.Move.To.Y
			}
			if elapsed >= a.Move.Duration {
				a.X = a.Move.To.X
				a.Y = a.Move.To.Y
				a.Move = nil
				r.indexActor(a)
				changed = true
				if a.State == "entering" && a.X >= 1 && a.Y >= 1 {
					a.Outside = false
				}
				r.nextStep(a, now)
			}
		} else if len(a.path) > 0 && !now.Before(a.due) {
			changed = r.nextStep(a, now)
			// A player gives up after waiting blockedRetries seconds, not on the first try.
			if !changed && a.Kind == "human" && len(a.path) == 0 {
				a.path = nil
				a.waits = 0
				changed = true
			}
		}
		if a.Kind == "staff" && r.clearDoorway(a, now) {
			changed = true
		}
		if a.Move == nil && len(a.path) == 0 {
			if a.State == "to_seat" {
				atChair := false
				for _, u := range r.world.Units {
					if u.ID == a.ChairID && u.X == a.X && u.Y == a.Y {
						atChair = true
						break
					}
				}
				if atChair {
					r.sit(a, now)
				} else {
					r.releaseSeat(a)
					if a.Kind == "npc" {
						a.State = "wandering"
					} else {
						a.State = "idle"
					}
					a.due = now.Add(time.Second)
				}
				changed = true
			}
			if busyState(a.State) && !now.Before(a.due) {
				a.State = "idle"
				a.Action = nil
				changed = true
			}
			if a.Kind == "staff" && !now.Before(a.due) {
				r.advanceStaff(a, now)
				changed = true
			}
			if a.Kind == "npc" && !now.Before(a.due) {
				if r.advanceNPC(a, now) {
					r.releaseSeat(a)
					delete(r.actors, a.ID)
					r.unindexActor(a.ID)
					removed = append(removed, a.ID)
					continue
				}
				changed = true
			}
		}
		if changed {
			updates = append(updates, r.status(a, false))
		}
	}
	if len(updates) > 0 || len(removed) > 0 {
		r.broadcast(gamewire.Event{Type: "actors", Actors: updates, Removed: removed}, "")
	}
	if r.shouldSpawn(now) {
		r.spawnNPC(now)
		r.spawnAt = now.Add(r.arrivalInterval(now))
	}
}

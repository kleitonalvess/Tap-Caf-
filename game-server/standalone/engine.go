// Package standalone runs a whole café in one process, without PocketBase or
// the room server: the room simulation (gameruntime) over the café rules
// (shared/cafe) kept in a MemoryStore. The js/wasm build (./wasm) drives it
// from a Web Worker and the browser keeps the save; the router answers the
// same /api/coffe routes the network client calls, so the client is the same.
package standalone

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"sync"
	"time"

	"coffe-mania/game-server/gameruntime"
	"coffe-mania/shared/cafe"
	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
)

// watchEvery: how often the engine compares the wall clock with the last check.
const watchEvery = 5 * time.Second

// Profile is the local player: one café per save, never a server account.
type Profile struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

var profileID = regexp.MustCompile(`^[a-z0-9]{15}$`)

// Hooks tell the page what changed. They run on engine goroutines and must
// not block.
type Hooks struct {
	// Committed runs after every saved change; the page saves the café
	// (debounced), so the save follows game transactions, never ticks.
	Committed func()
	// PlayerState runs when the HUD values changed (coins, XP, popularity).
	PlayerState func()
}

type Engine struct {
	store   *cafe.MemoryStore
	profile Profile
	options gameruntime.Options
	hooks   Hooks

	mu        sync.Mutex
	manager   *gameruntime.Manager
	suspended bool
	conns     map[*Connection]bool
	peers     int
	// The instant a pause stamps as slept_at when it is noticed late (zero: now).
	sleepAt time.Time
	// The last Resume: the absence before it was already counted.
	resumedAt time.Time
	stop      chan struct{}
	stopOnce  sync.Once
}

// New opens a café loaded from a save (or a new MemoryStore). lastSeen is
// the last moment the page was alive; see restore.
func New(store *cafe.MemoryStore, profile Profile, lastSeen time.Time, options gameruntime.Options, hooks Hooks) (*Engine, error) {
	if !profileID.MatchString(profile.ID) {
		return nil, errors.New("perfil local inválido")
	}
	if profile.Name == "" {
		profile.Name = "Jogador"
	}
	e := &Engine{store: store, profile: profile, options: options, hooks: hooks, conns: map[*Connection]bool{}, stop: make(chan struct{})}
	store.OnCommit = e.committed
	// Saves from before the granted flag get the same marking as the server's
	// migration 202610270001 (idempotent: a marked café changes nothing).
	if _, err := store.First("player_rooms", cafe.Where{"user": profile.ID}); err == nil {
		if _, err := cafe.MarkLegacyGranted(store, profile.ID); err != nil {
			return nil, err
		}
	}
	if err := e.restore(lastSeen); err != nil {
		return nil, err
	}
	e.manager = gameruntime.New(e.storage(), options)
	go e.watch()
	return e, nil
}

func (e *Engine) storage() storage { return storage{store: e.store, now: e.sleepClock} }

func (e *Engine) sleepClock() time.Time {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.sleepAt.IsZero() {
		return e.sleepAt
	}
	return time.Now()
}

// sleptFrom: the device slept with the page open when the wall clock jumped
// past the offline minimum since the last check; the absence starts there,
// unless a Resume after it already counted it (a hidden page that came back).
func sleptFrom(last, now, resumed time.Time) (time.Time, bool) {
	if resumed.After(last) {
		last = resumed
	}
	minimum := time.Duration(gamerules.Offline().MinAwaySeconds) * time.Second
	return last, now.Sub(last) >= minimum
}

// watch notices the device sleeping with the page in front: no hidden event
// arrives, so the café would never count the absence. Wall-clock readings
// (Round(0) drops the monotonic part, which may stop while asleep) find the
// gap; the café then sleeps at its start and wakes now, as a hidden page does.
func (e *Engine) watch() {
	ticker := time.NewTicker(watchEvery)
	defer ticker.Stop()
	last := time.Now().Round(0)
	for {
		select {
		case <-e.stop:
			return
		case <-ticker.C:
		}
		now := time.Now().Round(0)
		e.mu.Lock()
		suspended, resumed := e.suspended, e.resumedAt
		e.mu.Unlock()
		if from, slept := sleptFrom(last, now, resumed); slept && !suspended {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			if e.SuspendAt(ctx, from) == nil {
				e.Resume()
			}
			cancel()
		}
		last = now
	}
}

func (e *Engine) committed(collections []string) {
	if e.hooks.Committed != nil {
		e.hooks.Committed()
	}
	for _, name := range collections {
		if name == cafe.PlayerCollection && e.hooks.PlayerState != nil {
			e.hooks.PlayerState()
			return
		}
	}
}

// restore prepares a café read from a save. A room that slept on Suspend has
// slept_at and replays the absence when it wakes. A page closed while the
// room was awake never saved that sleep: the absence starts at the last
// moment the page was seen, and the customers inside left with it.
func (e *Engine) restore(lastSeen time.Time) error {
	if lastSeen.IsZero() {
		return nil
	}
	return e.store.Transaction(func(tx cafe.Store) error {
		room, err := tx.First("player_rooms", cafe.Where{"user": e.profile.ID})
		if errors.Is(err, cafe.ErrNotFound) {
			return nil
		}
		if err != nil || !room.GetTime("slept_at").IsZero() {
			return err
		}
		if now := time.Now(); lastSeen.After(now) {
			lastSeen = now
		}
		npcs, err := tx.Find("room_npcs", cafe.Query{Where: cafe.Where{"user": e.profile.ID}})
		if err != nil {
			return err
		}
		for _, npc := range npcs {
			if err := tx.Delete(npc); err != nil {
				return err
			}
		}
		room.Set("active", false)
		room.Set("human_count", 0)
		room.Set("slept_at", lastSeen)
		return tx.Save(room)
	})
}

// Export is the save: the whole café as JSON.
func (e *Engine) Export() ([]byte, error) { return e.store.Export() }

func (e *Engine) current() *gameruntime.Manager {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.manager
}

func (e *Engine) isSuspended() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.suspended
}

// Suspend puts the café to sleep while the page is hidden: the room saves
// its customers and stamps slept_at, as a room without players does on the
// server. Connections stay open and rejoin on Resume with a new welcome.
func (e *Engine) Suspend(ctx context.Context) error { return e.SuspendAt(ctx, time.Time{}) }

// SuspendAt is Suspend for a pause noticed late: slept_at is the instant the
// café actually stopped (zero: now).
func (e *Engine) SuspendAt(ctx context.Context, at time.Time) error {
	e.mu.Lock()
	if e.suspended {
		e.mu.Unlock()
		return nil
	}
	e.suspended = true
	e.sleepAt = at
	m := e.manager
	e.manager = nil
	conns := make([]*Connection, 0, len(e.conns))
	for c := range e.conns {
		conns = append(conns, c)
	}
	e.mu.Unlock()
	for _, c := range conns {
		c.detach()
	}
	err := m.Close(ctx)
	e.mu.Lock()
	e.sleepAt = time.Time{}
	e.mu.Unlock()
	return err
}

// Resume wakes the café: joined connections enter the room again, which
// replays the absence (WakeRoom) and greets the owner with it.
func (e *Engine) Resume() {
	e.mu.Lock()
	if !e.suspended {
		e.mu.Unlock()
		return
	}
	e.suspended = false
	e.resumedAt = time.Now().Round(0)
	e.manager = gameruntime.New(e.storage(), e.options)
	conns := make([]*Connection, 0, len(e.conns))
	for c := range e.conns {
		conns = append(conns, c)
	}
	e.mu.Unlock()
	for _, c := range conns {
		go c.attach()
	}
}

// Close stops the café for good, saving the room first.
func (e *Engine) Close(ctx context.Context) error {
	e.stopOnce.Do(func() { close(e.stop) })
	err := e.Suspend(ctx)
	e.mu.Lock()
	conns := make([]*Connection, 0, len(e.conns))
	for c := range e.conns {
		conns = append(conns, c)
	}
	e.mu.Unlock()
	for _, c := range conns {
		c.Close()
	}
	return err
}

func (e *Engine) nextPeerID() string {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.peers++
	return "local-" + strconv.Itoa(e.peers)
}

func (e *Engine) ticket() gamewire.Ticket {
	t := gamewire.Ticket{Room: e.profile.ID, User: e.profile.ID, Name: e.profile.Name}
	if state, err := cafe.GetOrCreatePlayer(e.store, e.profile.ID); err == nil {
		t.Appearance = state.GetString("appearance")
	}
	return t
}

// storage is the room simulation's persistence, in the same process. now is
// when a sleeping room says it fell asleep.
type storage struct {
	store cafe.Store
	now   func() time.Time
}

func (s storage) Load(_ context.Context, id string) (gamewire.Seed, error) {
	return cafe.LoadSeed(s.store, id, time.Now())
}

// Active leases presence on the server; a local café has one player.
func (s storage) Active(context.Context, string, int) error { return nil }

func (s storage) Sleep(_ context.Context, id string, state gamewire.Sleep) error {
	return cafe.SaveDormant(s.store, id, state, s.now())
}

func (s storage) Operate(_ context.Context, op gamewire.Operation) (gamewire.Result, error) {
	return cafe.Operate(s.store, op, time.Now()), nil
}

func (s storage) Consume(_ context.Context, room, food, table string, options gamewire.ServeOptions) (gamewire.Payment, error) {
	payment, err := cafe.ServeCustomerAs(s.store, room, food, table, options, time.Now())
	if errors.Is(err, cafe.ErrFoodGone) {
		return payment, gameruntime.ErrFoodGone
	}
	return payment, err
}

func (s storage) Feedback(_ context.Context, id string, satisfied bool) error {
	_, err := cafe.RecordVerdict(s.store, id, satisfied)
	return err
}

// Clean ignores a table that is already clean or gone, as the server does.
func (s storage) Clean(_ context.Context, room, table string) error {
	_, err := cafe.CleanTable(s.store, room, table, false)
	if errors.Is(err, cafe.ErrTableClean) || errors.Is(err, cafe.ErrRoomOwned) {
		return nil
	}
	return err
}

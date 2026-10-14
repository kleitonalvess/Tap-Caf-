package standalone

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"coffe-mania/game-server/gameruntime"
	"coffe-mania/shared/cafe"
	"coffe-mania/shared/gamewire"
)

var testProfile = Profile{ID: "localtest000001", Name: "Ana"}

type client struct {
	t      *testing.T
	conn   *Connection
	events chan gamewire.Event
	closed chan struct{}
}

func open(t *testing.T, e *Engine) *client {
	t.Helper()
	c := &client{t: t, events: make(chan gamewire.Event, 1024), closed: make(chan struct{}, 1)}
	c.conn = e.Connect(func(data []byte) {
		var event gamewire.Event
		if err := json.Unmarshal(data, &event); err != nil {
			t.Errorf("event: %v", err)
			return
		}
		c.events <- event
	}, func() { c.closed <- struct{}{} })
	return c
}

func (c *client) send(command gamewire.Command) {
	data, _ := json.Marshal(command)
	c.conn.Send(data)
}

// wait returns the first event of a type, skipping the others.
func (c *client) wait(kind string) gamewire.Event {
	c.t.Helper()
	timeout := time.After(10 * time.Second)
	for {
		select {
		case event := <-c.events:
			if event.Type == kind {
				return event
			}
		case <-c.closed:
			c.t.Fatalf("connection closed while waiting for %s", kind)
		case <-timeout:
			c.t.Fatalf("no %s event", kind)
		}
	}
}

func newEngine(t *testing.T, store *cafe.MemoryStore, lastSeen time.Time) *Engine {
	t.Helper()
	e, err := New(store, testProfile, lastSeen, gameruntime.Options{}, Hooks{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = e.Close(ctx)
	})
	return e
}

func fetchJSON(t *testing.T, e *Engine, method, path string, body any, out any) int {
	t.Helper()
	var data []byte
	if body != nil {
		data, _ = json.Marshal(body)
	}
	status, response := e.Fetch(method, path, data)
	if out != nil && len(response) > 0 {
		if err := json.Unmarshal(response, out); err != nil {
			t.Fatalf("%s %s: %v (%s)", method, path, err, response)
		}
	}
	return status
}

func TestProfileIsValidated(t *testing.T) {
	if _, err := New(cafe.NewMemoryStore(), Profile{ID: "../x"}, time.Time{}, gameruntime.Options{}, Hooks{}); err == nil {
		t.Fatal("an invalid profile id was accepted")
	}
}

func TestRoutesServeTheLocalCafe(t *testing.T) {
	e := newEngine(t, cafe.NewMemoryStore(), time.Time{})
	var session struct {
		PlayerID    string `json:"playerId"`
		DisplayName string `json:"displayName"`
		Offline     bool   `json:"offline"`
	}
	if status := fetchJSON(t, e, "GET", "/api/coffe/session", nil, &session); status != 200 || session.PlayerID != testProfile.ID || session.DisplayName != "Ana" || !session.Offline {
		t.Fatalf("session = %d %+v", status, session)
	}
	var room cafe.RoomSnapshot
	if status := fetchJSON(t, e, "GET", "/api/coffe/room?room="+testProfile.ID, nil, &room); status != 200 || !room.CanEdit || len(room.Inventory) == 0 || room.TilesX != 8 {
		t.Fatalf("room = %d canEdit=%v units=%d tiles=%d", status, room.CanEdit, len(room.Inventory), room.TilesX)
	}
	var state cafe.PlayerSnapshot
	if status := fetchJSON(t, e, "GET", "/api/coffe/player-state", nil, &state); status != 200 || state.Gold != 100 || state.Cash != cafe.StarterCash {
		t.Fatalf("player state = %d %+v", status, state)
	}
	var cooking cafe.CookingSnapshot
	if status := fetchJSON(t, e, "GET", "/api/coffe/cooking", nil, &cooking); status != 200 || len(cooking.Stoves) == 0 {
		t.Fatalf("cooking = %d %+v", status, cooking)
	}
	for _, path := range []string{"/api/coffe/rules", "/api/coffe/staff", "/api/coffe/npc-appearance"} {
		if status, body := e.Fetch("GET", path, nil); status != 200 || !json.Valid(body) {
			t.Fatalf("%s = %d", path, status)
		}
	}
	if status, _ := e.Fetch("GET", "/api/coffe/room?room=someoneelse0001", nil); status != 404 {
		t.Fatalf("another room = %d, want 404", status)
	}
	var failure struct {
		Message string `json:"message"`
	}
	if status := fetchJSON(t, e, "POST", "/api/coffe/appearance", map[string]string{"appearance": "{}"}, &failure); status != 400 || failure.Message == "" {
		t.Fatalf("invalid look = %d %+v", status, failure)
	}
	if status, _ := e.Fetch("POST", "/api/coffe/unknown", nil); status != 404 {
		t.Fatalf("unknown route = %d", status)
	}
	var ticket struct {
		RoomID  string `json:"roomId"`
		CanEdit bool   `json:"canEdit"`
	}
	if status := fetchJSON(t, e, "POST", "/api/coffe/game-ticket", map[string]string{"roomId": testProfile.ID}, &ticket); status != 200 || ticket.RoomID != testProfile.ID || !ticket.CanEdit {
		t.Fatalf("ticket = %d %+v", status, ticket)
	}
}

func TestOperationsGoThroughTheRoom(t *testing.T) {
	e := newEngine(t, cafe.NewMemoryStore(), time.Time{})
	var cooking cafe.CookingSnapshot
	fetchJSON(t, e, "GET", "/api/coffe/cooking", nil, &cooking)
	// The room checks that the avatar stands beside the stove, as on the server.
	var failure struct {
		Message string `json:"message"`
	}
	status := fetchJSON(t, e, "POST", "/api/coffe/cooking/start", map[string]string{"stoveId": cooking.Stoves[0].ID, "recipeId": "pao_de_queijo"}, &failure)
	if status != 409 || failure.Message == "" {
		t.Fatalf("cooking far from the stove = %d %+v", status, failure)
	}
	var street gamewire.Street
	if status := fetchJSON(t, e, "POST", "/api/coffe/street/farm/harvest", nil, &street); status != 200 || street.FreshCharges != 1 {
		t.Fatalf("harvest = %d %+v", status, street)
	}
	if status := fetchJSON(t, e, "POST", "/api/coffe/street/farm/harvest", nil, &failure); status != 409 {
		t.Fatalf("second harvest = %d %+v", status, failure)
	}
}

func TestCommitsReportPlayerState(t *testing.T) {
	commits, states := make(chan struct{}, 64), make(chan struct{}, 64)
	e, err := New(cafe.NewMemoryStore(), testProfile, time.Time{}, gameruntime.Options{}, Hooks{
		Committed:   func() { commits <- struct{}{} },
		PlayerState: func() { states <- struct{}{} },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close(context.Background())
	e.Fetch("GET", "/api/coffe/player-state", nil)
	if len(commits) == 0 || len(states) == 0 {
		t.Fatalf("creating the player: commits=%d states=%d", len(commits), len(states))
	}
	for len(states) > 0 {
		<-states
	}
	e.Fetch("GET", "/api/coffe/room", nil)
	if len(states) != 0 {
		t.Fatal("creating the room reported a player state change")
	}
}

func TestConnectionJoinsAndCommands(t *testing.T) {
	e := newEngine(t, cafe.NewMemoryStore(), time.Time{})
	c := open(t, e)
	c.send(gamewire.Command{Type: "join", Ticket: "local"})
	welcome := c.wait("welcome")
	if welcome.SelfID != "human:"+testProfile.ID || welcome.World == nil || welcome.World.RoomID != testProfile.ID {
		t.Fatalf("welcome = %+v", welcome)
	}
	x, y := 2, 2
	c.send(gamewire.Command{Type: "walk", RequestID: "walk-1", X: &x, Y: &y})
	for {
		event := c.wait("ack")
		if event.RequestID == "walk-1" {
			break
		}
	}
}

func TestSuspendKeepsTheConnectionAndResumeWelcomesAgain(t *testing.T) {
	store := cafe.NewMemoryStore()
	e := newEngine(t, store, time.Time{})
	c := open(t, e)
	c.send(gamewire.Command{Type: "join", Ticket: "local"})
	first := c.wait("welcome")
	if err := e.Suspend(context.Background()); err != nil {
		t.Fatal(err)
	}
	room, err := store.First("player_rooms", cafe.Where{"user": testProfile.ID})
	if err != nil || room.GetTime("slept_at").IsZero() {
		t.Fatalf("the paused room did not sleep: %v", err)
	}
	if status, _ := e.Fetch("POST", "/api/coffe/street/farm/harvest", nil); status != 503 {
		t.Fatalf("operation while paused = %d, want 503", status)
	}
	select {
	case <-c.closed:
		t.Fatal("pausing closed the connection")
	case <-time.After(200 * time.Millisecond):
	}
	e.Resume()
	second := c.wait("welcome")
	if second.Epoch == first.Epoch {
		t.Fatal("the resumed room kept the old epoch")
	}
	room, _ = store.First("player_rooms", cafe.Where{"user": testProfile.ID})
	if !room.GetTime("slept_at").IsZero() {
		t.Fatal("waking did not clear slept_at")
	}
}

// A tab closed with the room awake leaves a save without slept_at: the next
// start counts the absence from the last moment the page was seen.
func TestRestoreCountsTheAbsenceOfAClosedTab(t *testing.T) {
	store := cafe.NewMemoryStore()
	e := newEngine(t, store, time.Time{})
	c := open(t, e)
	c.send(gamewire.Command{Type: "join", Ticket: "local"})
	c.wait("welcome")
	saved, err := e.Export()
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := cafe.LoadMemoryStore(saved)
	if err != nil {
		t.Fatal(err)
	}
	seen := time.Now().Add(-10 * time.Minute).UTC().Truncate(time.Millisecond)
	other := newEngine(t, loaded, seen)
	room, _ := loaded.First("player_rooms", cafe.Where{"user": testProfile.ID})
	if !room.GetTime("slept_at").Equal(seen) {
		t.Fatalf("slept_at = %v, want %v", room.GetTime("slept_at"), seen)
	}
	back := open(t, other)
	back.send(gamewire.Command{Type: "join", Ticket: "local"})
	welcome := back.wait("welcome")
	if welcome.Away == nil || welcome.Away.From != seen.UnixMilli() {
		t.Fatalf("away = %+v, want one from %d", welcome.Away, seen.UnixMilli())
	}
	// A clean sleep keeps its own instant.
	if err := other.Suspend(context.Background()); err != nil {
		t.Fatal(err)
	}
	room, _ = loaded.First("player_rooms", cafe.Where{"user": testProfile.ID})
	slept := room.GetTime("slept_at")
	if err := other.restore(time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	room, _ = loaded.First("player_rooms", cafe.Where{"user": testProfile.ID})
	if !room.GetTime("slept_at").Equal(slept) {
		t.Fatal("restore moved the instant of a clean sleep")
	}
}

func TestClosedConnectionLeavesTheRoom(t *testing.T) {
	e := newEngine(t, cafe.NewMemoryStore(), time.Time{})
	c := open(t, e)
	c.send(gamewire.Command{Type: "join", Ticket: "local"})
	c.wait("welcome")
	c.conn.Close()
	c.conn.Send([]byte(`{"type":"walk"}`))
	watcher := open(t, e)
	watcher.send(gamewire.Command{Type: "join", Ticket: "local"})
	welcome := watcher.wait("welcome")
	humans := 0
	for _, actor := range welcome.Actors {
		if actor.Kind == "human" {
			humans++
		}
	}
	if humans != 1 {
		t.Fatalf("%d humans in the room, want 1", humans)
	}
}

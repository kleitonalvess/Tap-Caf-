package standalone

import (
	"context"
	"encoding/json"
	"runtime"
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

func TestSleptFromNeedsTheOfflineMinimumAndSkipsCountedPauses(t *testing.T) {
	t0 := time.Now().Round(0)
	if _, slept := sleptFrom(t0, t0.Add(time.Minute), time.Time{}); slept {
		t.Fatal("a one-minute gap counted as an absence")
	}
	from, slept := sleptFrom(t0, t0.Add(6*time.Hour), time.Time{})
	if !slept || !from.Equal(t0) {
		t.Fatalf("six hours asleep: %v from %v", slept, from)
	}
	// A hidden page that came back an hour ago already counted its absence.
	if _, slept := sleptFrom(t0, t0.Add(6*time.Hour), t0.Add(5*time.Hour+59*time.Minute)); slept {
		t.Fatal("an absence counted by the resume was counted again")
	}
}

func TestSuspendAtStampsTheInstantTheCafeStopped(t *testing.T) {
	store := cafe.NewMemoryStore()
	e := newEngine(t, store, time.Time{})
	c := open(t, e)
	c.send(gamewire.Command{Type: "join", Ticket: "local"})
	c.wait("welcome")
	stopped := time.Now().Add(-3 * time.Hour).UTC().Truncate(time.Millisecond)
	if err := e.SuspendAt(context.Background(), stopped); err != nil {
		t.Fatal(err)
	}
	room, _ := store.First("player_rooms", cafe.Where{"user": testProfile.ID})
	if !room.GetTime("slept_at").Equal(stopped) {
		t.Fatalf("slept_at = %v, want %v", room.GetTime("slept_at"), stopped)
	}
	e.Resume()
	welcome := c.wait("welcome")
	if welcome.Away == nil || welcome.Away.From != stopped.UnixMilli() {
		t.Fatalf("away = %+v", welcome.Away)
	}
	// The next pause is stamped now again.
	if err := e.Suspend(context.Background()); err != nil {
		t.Fatal(err)
	}
	room, _ = store.First("player_rooms", cafe.Where{"user": testProfile.ID})
	if time.Since(room.GetTime("slept_at")) > time.Minute {
		t.Fatalf("a plain pause kept the old instant: %v", room.GetTime("slept_at"))
	}
}

// Every connection the client closes lets go of its room peer and forwarder.
func TestClosedConnectionsDoNotLeakGoroutines(t *testing.T) {
	e := newEngine(t, cafe.NewMemoryStore(), time.Time{})
	warm := open(t, e)
	warm.send(gamewire.Command{Type: "join", Ticket: "local"})
	warm.wait("welcome")
	warm.conn.Close()
	time.Sleep(200 * time.Millisecond)
	before := runtime.NumGoroutine()
	for i := 0; i < 30; i++ {
		c := open(t, e)
		c.send(gamewire.Command{Type: "join", Ticket: "local"})
		c.wait("welcome")
		c.conn.Close()
	}
	deadline := time.Now().Add(5 * time.Second)
	for runtime.NumGoroutine() > before+2 && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if after := runtime.NumGoroutine(); after > before+2 {
		t.Fatalf("goroutines grew from %d to %d after 30 closed connections", before, after)
	}
}

func TestCheckSaveAcceptsOnlyThePlayersCafe(t *testing.T) {
	store := cafe.NewMemoryStore()
	e := newEngine(t, store, time.Time{})
	if status, _ := e.Fetch("GET", "/api/coffe/room", nil); status != 200 {
		t.Fatalf("room = %d", status)
	}
	var progress cafe.ProgressSnapshot
	if status := fetchJSON(t, e, "GET", "/api/coffe/progress", nil, &progress); status != 200 || len(progress.Missions) == 0 || len(progress.Achievements) == 0 {
		t.Fatalf("progress = %d %+v", status, progress)
	}
	var renamed cafe.PlayerSnapshot
	if status := fetchJSON(t, e, "POST", "/api/coffe/cafe/name", map[string]string{"name": " Café  Offline "}, &renamed); status != 200 || renamed.CafeName != "Café Offline" {
		t.Fatalf("rename = %d %+v", status, renamed)
	}
	if status, _ := e.Fetch("POST", "/api/coffe/cafe/name", []byte(`{"name":"<x>"}`)); status != 400 {
		t.Fatalf("invalid name = %d", status)
	}
	if status, _ := e.Fetch("POST", "/api/coffe/progress/claim", []byte(`{"kind":"mission","id":"nope"}`)); status != 404 {
		t.Fatalf("unknown mission = %d", status)
	}
	data, err := store.Export()
	if err != nil {
		t.Fatal(err)
	}
	if err := CheckSave(data, testProfile.ID); err != nil {
		t.Fatalf("own save refused: %v", err)
	}
	for name, bad := range map[string][]byte{"empty": nil, "not json": []byte("{oops"), "other version": []byte(`{"version":2,"collections":{}}`), "empty café": []byte(`{"version":1,"collections":{}}`)} {
		if CheckSave(bad, testProfile.ID) == nil {
			t.Errorf("%s accepted", name)
		}
	}
	if CheckSave(data, "someoneelse0001") == nil {
		t.Error("a save of another profile was accepted")
	}
}

// A restored backup opens as exported: clocks move by the time the file sat
// unused, so nothing cooks, spoils or counts as an absence in between.
func TestPrepareImportFreezesTheCafe(t *testing.T) {
	store := cafe.NewMemoryStore()
	e := newEngine(t, store, time.Time{})
	if status, _ := e.Fetch("GET", "/api/coffe/cooking", nil); status != 200 {
		t.Fatal("cooking")
	}
	stove, err := store.First("player_stoves", cafe.Where{"user": testProfile.ID})
	if err != nil {
		t.Fatal(err)
	}
	exported := time.Now().Add(-72 * time.Hour).UTC().Truncate(time.Millisecond)
	if err := cafe.StartCooking(store, testProfile.ID, stove.ID(), "cake_1", exported); err != nil {
		t.Fatal(err)
	}
	room, _ := store.First("player_rooms", cafe.Where{"user": testProfile.ID})
	room.Set("slept_at", exported)
	if err := store.Save(room); err != nil {
		t.Fatal(err)
	}
	data, _ := store.Export()
	now := time.Now().UTC().Truncate(time.Millisecond)
	prepared, err := PrepareImport(data, testProfile.ID, exported, now)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := cafe.LoadMemoryStore(prepared)
	if err != nil {
		t.Fatal(err)
	}
	job, _ := loaded.First("stove_cooking", cafe.Where{"stove": stove.ID()})
	if got := job.GetTime("preparing_at"); !got.Equal(now) {
		t.Fatalf("preparing_at = %v, want %v", got, now)
	}
	if status, _ := cafe.JobState(job, now.Add(time.Second)); status != "preparing" {
		t.Fatalf("the dish is %s right after the import", status)
	}
	sleptRoom, _ := loaded.First("player_rooms", cafe.Where{"user": testProfile.ID})
	if got := sleptRoom.GetTime("slept_at"); !got.Equal(now) {
		t.Fatalf("slept_at = %v, want the import instant", got)
	}
	if _, err := PrepareImport(data, "someoneelse0001", exported, now); err == nil {
		t.Fatal("another profile was accepted")
	}
}

func TestUnknownFieldsAreRefusedLikeOnTheServer(t *testing.T) {
	e := newEngine(t, cafe.NewMemoryStore(), time.Time{})
	var cooking cafe.CookingSnapshot
	fetchJSON(t, e, "GET", "/api/coffe/cooking", nil, &cooking)
	for _, call := range []struct {
		path string
		body any
	}{
		{"/api/coffe/crates/open", map[string]any{"crate": "surprise", "requestId": "strict-request-0001", "extra": 1}},
		{"/api/coffe/pantry/buy", map[string]any{"code": 800001, "free": true}},
		{"/api/coffe/progress/claim", map[string]any{"kind": "mission", "id": "x", "force": true}},
		{"/api/coffe/cooking/start", map[string]any{"stoveId": cooking.Stoves[0].ID, "recipeId": "pao_de_queijo", "costCoins": 0}},
		{"/api/coffe/room/expand", map[string]any{"tiles": 10, "pay": "coins", "level": 99}},
	} {
		if status := fetchJSON(t, e, "POST", call.path, call.body, nil); status != 400 {
			t.Fatalf("%s with an unknown field = %d, want 400", call.path, status)
		}
	}
	// The street buildings ignore any body, as the PocketBase route does.
	if status := fetchJSON(t, e, "POST", "/api/coffe/street/farm/harvest", map[string]any{"anything": 1}, nil); status != 200 {
		t.Fatalf("harvest with a body = %d", status)
	}
}

// A non-player neighbour's café opens in the browser: a ticket into it, the
// visitor's view of the room, the help paid there and nothing else allowed.
func TestVisitingANeighborCafe(t *testing.T) {
	e := newEngine(t, cafe.NewMemoryStore(), time.Time{})
	const neighbor = "npcneighbor0003"
	var ticket struct {
		Ticket  string `json:"ticket"`
		RoomID  string `json:"roomId"`
		CanEdit bool   `json:"canEdit"`
	}
	if status := fetchJSON(t, e, "POST", "/api/coffe/game-ticket", map[string]string{"roomId": neighbor}, &ticket); status != 200 || ticket.RoomID != neighbor || ticket.CanEdit {
		t.Fatalf("ticket: %d %+v", status, ticket)
	}
	if status := fetchJSON(t, e, "POST", "/api/coffe/game-ticket", map[string]string{"roomId": "someoneelse0001"}, nil); status != 404 {
		t.Fatalf("a stranger's café: %d", status)
	}
	var room cafe.RoomSnapshot
	if status := fetchJSON(t, e, "GET", "/api/coffe/room?room="+neighbor, nil, &room); status != 200 || room.CanEdit || room.TipJar != nil || room.RoomID != neighbor {
		t.Fatalf("visitor room: %d %+v", status, room.RoomID)
	}
	c := open(t, e)
	c.send(gamewire.Command{Type: "join", Ticket: ticket.Ticket})
	welcome := c.wait("welcome")
	if welcome.World == nil || welcome.World.RoomID != neighbor || len(welcome.World.Dirt) == 0 {
		t.Fatalf("welcome into the neighbour's café: %+v", welcome.World)
	}
	table := welcome.World.Dirt[0].TableID
	// The help needs the visitor beside the table; far away the room refuses it.
	if status := fetchJSON(t, e, "POST", "/api/coffe/room/tables/clean", map[string]string{"tableId": table, "roomId": neighbor}, nil); status != 409 {
		t.Fatalf("cleaning from across the room: %d", status)
	}
	if status := fetchJSON(t, e, "POST", "/api/coffe/room/purchase", map[string]any{"itemId": 3500000, "tx": 2, "ty": 2, "rotation": 0, "revision": 1, "requestId": "visitor-purchase-0001", "roomId": neighbor}, nil); status != 400 {
		t.Fatalf("a visitor buying for the neighbour: %d", status)
	}
	var neighbors cafe.NeighborsSnapshot
	if status := fetchJSON(t, e, "GET", "/api/coffe/neighbors", nil, &neighbors); status != 200 || len(neighbors.Neighbors) == 0 {
		t.Fatalf("neighbours: %d", status)
	}
	var gifts cafe.GiftsSnapshot
	if status := fetchJSON(t, e, "GET", "/api/coffe/gifts", nil, &gifts); status != 200 || len(gifts.Received) == 0 {
		t.Fatalf("gifts: %d", status)
	}
	if status := fetchJSON(t, e, "POST", "/api/coffe/gifts/send", map[string]string{"to": neighbor, "item": "coins"}, nil); status != 200 {
		t.Fatalf("send a gift: %d", status)
	}
}

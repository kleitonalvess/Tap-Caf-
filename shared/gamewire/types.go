// Package gamewire is the protocol between the independent room service and persistence.
// It has no database, renderer or PocketBase dependency.
package gamewire

import "encoding/json"

type Tile struct {
	X int `json:"tx"`
	Y int `json:"ty"`
}
type Unit struct {
	ID       string `json:"unitId"`
	ItemID   int    `json:"itemId"`
	Placed   bool   `json:"placed"`
	X        int    `json:"tx"`
	Y        int    `json:"ty"`
	Rotation int    `json:"rotation"`
	StoveID  string `json:"stoveId,omitempty"`
}
type Food struct {
	ID     string `json:"id"`
	Recipe string `json:"recipeId"`
	// Servings left in this dish; each customer takes one.
	Servings int `json:"servings,omitempty"`
	// Inventory unit of the counter holding the dish; empty for older dishes.
	CounterID string `json:"counterId,omitempty"`
	// Servings made with fresh farm ingredients (they pay a bonus); the first ones served.
	Fresh int `json:"fresh,omitempty"`
}

// Street is the state of the buildings across the street, from absolute
// instants (unix milliseconds); zero means "now" or "never".
type Street struct {
	// When the farm can be harvested again, and the fresh-ingredient charges
	// waiting for the next batch.
	FarmReadyAt  int64 `json:"farmReadyAt,omitempty"`
	FreshCharges int   `json:"freshCharges,omitempty"`
	// The current or last party, and when the next one may start.
	PartyStartedAt int64 `json:"partyStartedAt,omitempty"`
	PartyEndsAt    int64 `json:"partyEndsAt,omitempty"`
	PartyReadyAt   int64 `json:"partyReadyAt,omitempty"`
}

// AwaySummary is what the café did while the owner was away: the room slept
// and, on waking, persistence replayed the absence (OfflineRules). It is kept
// until the owner acknowledges it, accumulating several absences.
type AwaySummary struct {
	// Unix milliseconds: the absence and the part of it that was replayed (capped).
	From      int64 `json:"from"`
	To        int64 `json:"to"`
	Simulated int64 `json:"simulatedMs"`
	Served    int   `json:"served"`
	// Coins include Tips and FreshCoins.
	Coins      int64 `json:"coins"`
	Tips       int64 `json:"tips"`
	FreshCoins int64 `json:"freshCoins"`
	XP         int64 `json:"xp"`
	LevelFrom  int   `json:"levelFrom"`
	LevelTo    int   `json:"levelTo"`
	// Popularity in tenths before and after.
	PopularityFrom int `json:"popularityFrom"`
	PopularityTo   int `json:"popularityTo"`
	// Plates left on the tables, and plates the staff cleared.
	Plates  int `json:"plates"`
	Cleared int `json:"cleared"`
	// Who worked, servings still on the counters, batches waiting on the stoves.
	Waiters      int `json:"waiters"`
	Cleaners     int `json:"cleaners"`
	ServingsLeft int `json:"servingsLeft"`
	ReadyDishes  int `json:"readyDishes"`
	SpoiledDish  int `json:"spoiledDishes"`
}

// PartyActive reports whether a party is on at the given instant.
func (s *Street) PartyActive(nowMs int64) bool {
	return s != nil && s.PartyStartedAt <= nowMs && nowMs < s.PartyEndsAt
}

// Payment is credited by persistence when a customer takes a serving; the room
// broadcasts it at that moment, together with the owner's HUD update.
type Payment struct {
	ActorID  string `json:"actorId,omitempty"`
	RecipeID string `json:"recipeId"`
	Coins    int64  `json:"coins"`
	// Tip is the part of Coins a waiter's delivery (or a party) earned.
	Tip int64 `json:"tip,omitempty"`
	// Fresh-ingredient bonus included in Coins and XP, and fresh servings left on the dish.
	FreshCoins       int64 `json:"freshCoins,omitempty"`
	FreshXP          int64 `json:"freshXp,omitempty"`
	FreshLeft        int   `json:"freshLeft,omitempty"`
	XP               int64 `json:"xp"`
	Level            int   `json:"level"`
	LevelUp          bool  `json:"levelUp,omitempty"`
	LevelReward      int64 `json:"levelReward,omitempty"`
	ServingsLeft     int   `json:"servingsLeft"`
	PopularityTenths int   `json:"popularityTenths"`
}
type World struct {
	RoomID   string          `json:"roomId"`
	Revision int             `json:"revision"`
	TilesX   int             `json:"tilesX"`
	TilesY   int             `json:"tilesY"`
	Units    []Unit          `json:"units"`
	Foods    []Food          `json:"foods"`
	Dirt     []Dirt          `json:"dirt"`
	Staff    []StaffMember   `json:"staff"`
	Street   *Street         `json:"street,omitempty"`
	Cooking  json.RawMessage `json:"cooking,omitempty"`
}

// StaffMember is one hired employee as the room simulates it.
type StaffMember struct {
	ID         string `json:"id"`
	Profile    string `json:"profile"`
	Name       string `json:"name"`
	Role       string `json:"role"`
	Appearance string `json:"appearance"`
}

// Dirt is the dishes left on one table; a dirty table seats nobody.
type Dirt struct {
	TableID string `json:"tableId"`
	Plates  int    `json:"plates"`
	// Unix milliseconds of the oldest plate.
	Since int64 `json:"since"`
}
type Movement struct {
	From      Tile  `json:"from"`
	To        Tile  `json:"to"`
	StartedAt int64 `json:"startedAt"`
	Duration  int64 `json:"duration"`
}
type ActorAction struct {
	Kind      string `json:"kind"`
	StoveID   string `json:"stoveId,omitempty"`
	StartedAt int64  `json:"startedAt"`
	Duration  int64  `json:"duration"`
}

// Patience is how long a seated customer still waits for food.
type Patience struct {
	StartedAt int64 `json:"startedAt"`
	Duration  int64 `json:"duration"`
}
type Emotion struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	StartedAt int64  `json:"startedAt"`
	Duration  int64  `json:"duration"`
}
type Actor struct {
	ID              string       `json:"id"`
	Kind            string       `json:"kind,omitempty"`
	Name            string       `json:"name,omitempty"`
	Appearance      string       `json:"appearance,omitempty"`
	X               int          `json:"tx"`
	Y               int          `json:"ty"`
	Direction       int          `json:"direction"`
	Outside         bool         `json:"outside"`
	State           string       `json:"state"`
	Move            *Movement    `json:"move,omitempty"`
	ChairID         string       `json:"chairId,omitempty"`
	TableID         string       `json:"tableId,omitempty"`
	Food            *Food        `json:"food,omitempty"`
	ActionRemaining int64        `json:"actionRemaining,omitempty"`
	Action          *ActorAction `json:"action,omitempty"`
	Emotion         *Emotion     `json:"emotion,omitempty"`
	EmotionShown    bool         `json:"emotionShown,omitempty"`
	Patience        *Patience    `json:"patience,omitempty"`
	// A customer who came in while nothing could be served: leaving unserved costs nothing.
	Browsing bool `json:"browsing,omitempty"`
	// Staff role ("waiter" or "cleaner"); empty for customers and players.
	Role string `json:"role,omitempty"`
	// Paths/timers are saved only on dormancy; they are never broadcast in hot updates.
	Path              []Tile `json:"path,omitempty"`
	Visits            int    `json:"visits,omitempty"`
	PatienceRemaining int64  `json:"patienceRemaining,omitempty"`
}
type Seed struct {
	World World    `json:"world"`
	NPCs  []Actor  `json:"npcs"`
	Looks []string `json:"looks"`
	// Owner popularity in tenths; it paces customer arrivals.
	PopularityTenths int `json:"popularityTenths"`
	// The owner's unacknowledged absence summary, handed over on their welcome.
	Away *AwaySummary `json:"away,omitempty"`
}
type Sleep struct {
	NPCs []Actor `json:"npcs"`
}
type Operation struct {
	Owner  string          `json:"owner"`
	User   string          `json:"user"`
	Action string          `json:"action"`
	Body   json.RawMessage `json:"body"`
}
type Result struct {
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
	World  *World          `json:"world,omitempty"`
}
type Event struct {
	Type      string   `json:"type"`
	Epoch     string   `json:"epoch"`
	Seq       uint64   `json:"seq"`
	ServerNow int64    `json:"serverNow"`
	SelfID    string   `json:"selfId,omitempty"`
	World     *World   `json:"world,omitempty"`
	Actors    []Actor  `json:"actors,omitempty"`
	Removed   []string `json:"removed,omitempty"`
	Units     []Unit   `json:"units,omitempty"`
	Revision  int      `json:"revision,omitempty"`
	// Set on a world event when the room grew (expansion).
	TilesX int `json:"tilesX,omitempty"`
	TilesY int `json:"tilesY,omitempty"`
	// Welcome to the owner only: what happened while they were away.
	Away *AwaySummary `json:"away,omitempty"`
	// Set on a world event when the farm or the disco changed.
	Street    *Street         `json:"street,omitempty"`
	Cooking   json.RawMessage `json:"cooking,omitempty"`
	Foods     []Food          `json:"foods,omitempty"`
	Dirt      []Dirt          `json:"dirt,omitempty"`
	Payment   *Payment        `json:"payment,omitempty"`
	RequestID string          `json:"requestId,omitempty"`
	Message   string          `json:"message,omitempty"`
}
type Command struct {
	Type      string `json:"type"`
	Ticket    string `json:"ticket,omitempty"`
	RequestID string `json:"requestId,omitempty"`
	X         *int   `json:"tx,omitempty"`
	Y         *int   `json:"ty,omitempty"`
	ChairID   string `json:"chairId,omitempty"`
	StoveID   string `json:"stoveId,omitempty"`
}

// Latency is private transport telemetry, outside the ordered room event stream.
type Latency struct {
	Type  string  `json:"type"`
	RTTMs float64 `json:"rttMs"`
}

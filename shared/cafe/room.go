package cafe

import (
	"coffe-mania/shared/gamerules"

	"time"

	"encoding/json"
	"errors"
	"regexp"

	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/roomcatalog"
)

var ErrRoomConflict = errors.New("O quarto mudou em outra janela. A visão foi atualizada; tente novamente.")
var ErrRoomGold = errors.New("Moedas insuficientes.")
var ErrRoomPosition = errors.New("Posição inválida ou ocupada para este item.")
var ErrRoomOwned = errors.New("Esta unidade não pertence ao seu inventário.")
var ErrRoomOperation = errors.New("Identificador de operação já utilizado em outro pedido.")
var ErrRoomBusy = errors.New("Não é possível mover um fogão durante o preparo.")
var ErrCounterBusy = errors.New("Não é possível mover um balcão com comida.")

// RequestKeyPattern is the idempotency key of a room command.
var RequestKeyPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{16,80}$`)

type RoomUnit struct {
	UnitID   string `json:"unitId"`
	ItemID   int    `json:"itemId"`
	Placed   bool   `json:"placed"`
	TX       int    `json:"tx"`
	TY       int    `json:"ty"`
	Rotation int    `json:"rotation"`
	StoveID  string `json:"stoveId,omitempty"`
}
type RoomSnapshot struct {
	RoomID      string             `json:"roomId"`
	CanEdit     bool               `json:"canEdit"`
	Revision    int                `json:"revision"`
	TilesX      int                `json:"tilesX"`
	TilesY      int                `json:"tilesY"`
	Inventory   []RoomUnit         `json:"inventory"`
	Catalog     []roomcatalog.Item `json:"catalog"`
	PlayerState PlayerSnapshot     `json:"playerState"`
	// The owner's café as its visitors see it (PlayerState is the viewer's own HUD).
	Cafe   CafeInfo        `json:"cafe"`
	Street gamewire.Street `json:"street"`
	// The owner's unacknowledged absence summary (never sent to visitors).
	AwaySummary *gamewire.AwaySummary `json:"awaySummary,omitempty"`
}
type RoomCommand struct {
	ItemID    int    `json:"itemId,omitempty"`
	UnitID    string `json:"unitId,omitempty"`
	TX        *int   `json:"tx"`
	TY        *int   `json:"ty"`
	Rotation  *int   `json:"rotation"`
	Revision  *int   `json:"revision"`
	RequestID string `json:"requestId"`
}

// starterRoom is the furniture of a new café: item, tile and rotation.
var starterRoom = [][4]int{{3070000, 6, 2, 3}, {3080000, 7, 3, 0}, {3010000, 4, 1, 1}, {3000011, 0, 2, 0}, {3000011, 0, 6, 0},
	{3040001, 2, 3, 0}, {3040001, 2, 5, 0}, {3040001, 5, 5, 0}, {3030010, 3, 3, 0}, {3030010, 3, 5, 0}, {3030010, 6, 5, 0},
	{3200000, 2, 0, 1}, {3300000, 1, 7, 0}, {3100000, 5, 0, 1}, {3020003, 1, 1, 0}, {3020003, 7, 1, 0}, {3020003, 7, 7, 0}}

// EnsureRoom provisions the starter room and its owned inventory units once, without charging gold.
func EnsureRoom(s Store, userID string) error {
	if _, err := s.First("player_rooms", Where{"user": userID}); err == nil {
		return nil
	} else if !errors.Is(err, ErrNotFound) {
		return err
	}
	if _, err := GetOrCreatePlayer(s, userID); err != nil {
		return err
	}
	if err := EnsureStarterStove(s, userID); err != nil {
		return err
	}
	return s.Transaction(func(tx Store) error {
		_, err := tx.First("player_rooms", Where{"user": userID})
		if err == nil {
			return nil
		}
		if !errors.Is(err, ErrNotFound) {
			return err
		}
		add := func(id, x, y, rotation int) error {
			item, ok := roomcatalog.ByID(id)
			if !ok {
				return errors.New("starter item missing")
			}
			unit, err := tx.New("player_inventory")
			if err != nil {
				return err
			}
			setAll(unit, map[string]any{"user": userID, "item_id": id, "tx": x, "ty": y, "rotation": rotation, "placed": true, "layer": roomcatalog.Layer(item)})
			if item.Kind == "stove" {
				stove, err := tx.First("player_stoves", Where{"user": userID, "item_id": id})
				if err != nil {
					return err
				}
				unit.Set("stove_id", stove.ID())
				unit.Set("tx", stove.GetInt("tx"))
				unit.Set("ty", stove.GetInt("ty"))
			}
			return tx.Save(unit)
		}
		for _, starter := range starterRoom {
			if err := add(starter[0], starter[1], starter[2], starter[3]); err != nil {
				return err
			}
		}
		for y := 0; y < 8; y++ {
			for x := 0; x < 8; x++ {
				if x > 0 && y > 0 {
					if err := add(3050000, x, y, 0); err != nil {
						return err
					}
					continue
				}
				id, rotation := 3090000, 0
				if y == 0 && x > 0 {
					rotation = 1
				}
				if x == 0 && y == 0 {
					id = 3090001
				}
				if err := add(id, x, y, rotation); err != nil {
					return err
				}
				if id != 3090001 {
					if err := add(3060016, x, y, rotation); err != nil {
						return err
					}
				}
			}
		}
		room, err := tx.New("player_rooms")
		if err != nil {
			return err
		}
		setAll(room, map[string]any{"user": userID, "revision": 1, "tiles_x": 8, "tiles_y": 8})
		return tx.Save(room)
	})
}

// SnapshotRoom is the owner's view of the room; the HTTP layer trims it for visitors.
func SnapshotRoom(s Store, userID string) (RoomSnapshot, error) {
	result := RoomSnapshot{RoomID: userID, CanEdit: true, Inventory: []RoomUnit{}, Catalog: roomcatalog.Items}
	room, err := s.First("player_rooms", Where{"user": userID})
	if err != nil {
		return result, err
	}
	result.Revision = room.GetInt("revision")
	result.TilesX = room.GetInt("tiles_x")
	result.TilesY = room.GetInt("tiles_y")
	result.Street = StreetState(room)
	// While the room sleeps, the owner's welcome brings the summary merged
	// with the absence that is about to be replayed; sending the stored one
	// here as well would show the same earnings twice.
	if room.GetTime("slept_at").IsZero() {
		result.AwaySummary = awaySummary(room)
	}
	units, err := s.Find("player_inventory", Query{Where: Where{"user": userID}, Sort: []string{"id"}, Limit: 10000})
	if err != nil {
		return result, err
	}
	for _, unit := range units {
		result.Inventory = append(result.Inventory, RoomUnit{unit.ID(), unit.GetInt("item_id"), unit.GetBool("placed"), unit.GetInt("tx"), unit.GetInt("ty"), unit.GetInt("rotation"), unit.GetString("stove_id")})
	}
	state, err := s.First(PlayerCollection, Where{"user": userID})
	if err != nil {
		return result, err
	}
	result.PlayerState = PlayerView(state)
	result.Cafe = CafeInfo{Name: result.PlayerState.CafeName, Popularity: result.PlayerState.Satisfaction.Current}
	return result, nil
}

func validRoomPosition(item roomcatalog.Item, x, y, rotation, tilesX, tilesY int) bool {
	if rotation < 0 || rotation > 3 || x < 0 || y < 0 || x >= tilesX || y >= tilesY {
		return false
	}
	if item.Type == 1 {
		return (x == 0 && y > 0 && rotation%2 == 0) || (y == 0 && x > 0 && rotation%2 == 1)
	}
	if item.Kind == "wall" {
		return false
	}
	if item.Kind == "window" || item.Kind == "panel" {
		return (x == 0 && y > 0 && rotation%2 == 0) || (y == 0 && x > 0 && rotation%2 == 1)
	}
	if item.Kind == "door" {
		return (x == 1 && y > 0 && rotation%2 == 0) || (y == 1 && x > 0 && rotation%2 == 1)
	}
	sx, sy := item.SizeX, item.SizeY
	if rotation%2 == 1 {
		sx, sy = sy, sx
	}
	return x >= 1 && y >= 1 && x+sx <= tilesX && y+sy <= tilesY
}

// MutateRoom buys, moves or stores one unit. A repeated request id returns the
// current room without acting twice; a reused id with another payload fails.
func MutateRoom(s Store, userID, action string, command RoomCommand, now time.Time) (RoomSnapshot, error) {
	var result RoomSnapshot
	payloadBytes, _ := json.Marshal(struct {
		Action  string
		Command RoomCommand
	}{action, command})
	payload := string(payloadBytes)
	err := s.Transaction(func(tx Store) error {
		operation, err := tx.First("room_operations", Where{"user": userID, "request_key": command.RequestID})
		if err == nil {
			if operation.GetString("payload") != payload {
				return ErrRoomOperation
			}
			result, err = SnapshotRoom(tx, userID)
			return err
		}
		if !errors.Is(err, ErrNotFound) {
			return err
		}
		room, err := tx.First("player_rooms", Where{"user": userID})
		if err != nil {
			return err
		}
		if room.GetInt("revision") != *command.Revision {
			return ErrRoomConflict
		}
		var unit Record
		var item roomcatalog.Item
		if action == "purchase" {
			var ok bool
			item, ok = roomcatalog.ByID(command.ItemID)
			if !ok || !item.Purchasable {
				return ErrRoomPosition
			}
			state, err := tx.First(PlayerCollection, Where{"user": userID})
			if err != nil {
				return err
			}
			if state.GetInt64("gold") < item.PriceGold {
				return ErrRoomGold
			}
			if unit, err = tx.New("player_inventory"); err != nil {
				return err
			}
			setAll(unit, map[string]any{"user": userID, "item_id": item.ID, "layer": roomcatalog.Layer(item)})
			state.Set("gold", state.GetInt64("gold")-item.PriceGold)
			if err := tx.Save(state); err != nil {
				return err
			}
			if err := count(tx, userID, now, gamerules.StatSpentCoins, item.PriceGold); err != nil {
				return err
			}
		} else {
			unit, err = tx.Get("player_inventory", command.UnitID)
			if err != nil || unit.GetString("user") != userID {
				return ErrRoomOwned
			}
			var ok bool
			item, ok = roomcatalog.ByID(unit.GetInt("item_id"))
			if !ok || roomcatalog.Layer(item) == "structure" {
				return ErrRoomPosition
			}
			if stoveID := unit.GetString("stove_id"); stoveID != "" {
				_, err := tx.First("stove_cooking", Where{"stove": stoveID})
				if err == nil {
					return ErrRoomBusy
				}
				if !errors.Is(err, ErrNotFound) {
					return err
				}
			}
			if item.Kind == "counter" {
				_, err := tx.First("room_food", Where{"user": userID, "counter": unit.ID()})
				if err == nil {
					return ErrCounterBusy
				}
				if !errors.Is(err, ErrNotFound) {
					return err
				}
			}
			// Plates belong to the table where they were left.
			if item.Kind == "table" {
				dirty, err := tableIsDirty(tx, userID, unit.ID())
				if err != nil {
					return err
				}
				if dirty {
					return ErrTableDirty
				}
			}
		}
		if action == "store" {
			unit.Set("placed", false)
		} else {
			x, y, rotation := *command.TX, *command.TY, *command.Rotation
			if !validRoomPosition(item, x, y, rotation, room.GetInt("tiles_x"), room.GetInt("tiles_y")) {
				return ErrRoomPosition
			}
			units, err := tx.Find("player_inventory", Query{Where: Where{"user": userID}, Limit: 10000})
			if err != nil {
				return err
			}
			if len(units) >= 4000 && action == "purchase" {
				return ErrRoomPosition
			}
			sx, sy := item.SizeX, item.SizeY
			if rotation%2 == 1 {
				sx, sy = sy, sx
			}
			for _, other := range units {
				if !other.GetBool("placed") || other.ID() == unit.ID() || other.GetString("layer") != roomcatalog.Layer(item) {
					continue
				}
				otherItem, ok := roomcatalog.ByID(other.GetInt("item_id"))
				if !ok {
					return ErrRoomPosition
				}
				osx, osy := otherItem.SizeX, otherItem.SizeY
				if other.GetInt("rotation")%2 == 1 {
					osx, osy = osy, osx
				}
				ox, oy := other.GetInt("tx"), other.GetInt("ty")
				if x < ox+osx && x+sx > ox && y < oy+osy && y+sy > oy {
					if item.Type > 1 {
						return ErrRoomPosition
					}
					other.Set("placed", false)
					if err := tx.Save(other); err != nil {
						return err
					}
				}
			}
			unit.Set("placed", true)
			unit.Set("tx", x)
			unit.Set("ty", y)
			unit.Set("rotation", rotation)
		}
		if err := tx.Save(unit); err != nil {
			return err
		}
		if stoveID := unit.GetString("stove_id"); stoveID != "" {
			stove, err := tx.Get("player_stoves", stoveID)
			if err != nil {
				return err
			}
			// Stored stoves keep their position in the cooking table; unplaced units cannot cook.
			if unit.GetBool("placed") {
				stove.Set("tx", unit.GetInt("tx"))
				stove.Set("ty", unit.GetInt("ty"))
				if err := tx.Save(stove); err != nil {
					return err
				}
			}
		}
		room.Set("revision", room.GetInt("revision")+1)
		if err := tx.Save(room); err != nil {
			return err
		}
		saved, err := tx.New("room_operations")
		if err != nil {
			return err
		}
		setAll(saved, map[string]any{"user": userID, "request_key": command.RequestID, "payload": payload})
		if err := tx.Save(saved); err != nil {
			return err
		}
		result, err = SnapshotRoom(tx, userID)
		return err
	})
	return result, err
}

package cafe

import (
	"time"

	"errors"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/roomcatalog"
)

var ErrTableClean = errors.New("A mesa já está limpa.")
var ErrTableDirty = errors.New("Limpe a mesa antes de movê-la.")

// placedTable reports whether the unit is one of the owner's tables in the room.
func placedTable(s Store, owner, unitID string) bool {
	unit, err := s.Get("player_inventory", unitID)
	if err != nil || unit.GetString("user") != owner || !unit.GetBool("placed") {
		return false
	}
	item, ok := roomcatalog.ByID(unit.GetInt("item_id"))
	return ok && item.Kind == "table"
}

// leavePlate records the dishes a customer leaves on a table; called inside the
// payment transaction, so every paid meal dirties its table exactly once.
func leavePlate(tx Store, owner, tableID string) error {
	if tableID == "" || !placedTable(tx, owner, tableID) {
		return nil
	}
	plate, err := tx.New("room_dirt")
	if err != nil {
		return err
	}
	plate.Set("user", owner)
	plate.Set("table_id", tableID)
	return tx.Save(plate)
}

// RoomDirt groups the plates per table for the world snapshot.
func RoomDirt(s Store, owner string) ([]gamewire.Dirt, error) {
	plates, err := s.Find("room_dirt", Query{Where: Where{"user": owner}, Sort: []string{"created"}})
	if err != nil {
		return nil, err
	}
	dirt := []gamewire.Dirt{}
	index := map[string]int{}
	for _, plate := range plates {
		table := plate.GetString("table_id")
		if i, ok := index[table]; ok {
			dirt[i].Plates++
			continue
		}
		index[table] = len(dirt)
		dirt = append(dirt, gamewire.Dirt{TableID: table, Plates: 1, Since: plate.GetTime("created").UnixMilli()})
	}
	return dirt, nil
}

func tableIsDirty(tx Store, owner, tableID string) (bool, error) {
	_, err := tx.First("room_dirt", Where{"user": owner, "table_id": tableID})
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	return err == nil, err
}

// CleanTable clears every plate on the table; reward grants the owner the
// cleaning XP when the owner did it in person.
func CleanTable(s Store, owner, tableID string, reward bool) (int, error) {
	return CleanTableAt(s, owner, tableID, reward, time.Now())
}

// CleanTableAt is CleanTable as of now: a table the owner cleared in person
// also counts for achievements and missions (staff cleaning does not).
func CleanTableAt(s Store, owner, tableID string, reward bool, now time.Time) (int, error) {
	cleared := 0
	err := s.Transaction(func(tx Store) error {
		if !placedTable(tx, owner, tableID) {
			return ErrRoomOwned
		}
		plates, err := tx.Find("room_dirt", Query{Where: Where{"user": owner, "table_id": tableID}})
		if err != nil {
			return err
		}
		if len(plates) == 0 {
			return ErrTableClean
		}
		for _, plate := range plates {
			if err = tx.Delete(plate); err != nil {
				return err
			}
		}
		cleared = len(plates)
		if reward {
			if err = count(tx, owner, now, gamerules.StatTables, 1); err != nil {
				return err
			}
		}
		if xp := gamerules.Tables().CleaningXP; reward && xp > 0 {
			state, err := GetOrCreatePlayer(tx, owner)
			if err != nil {
				return err
			}
			Grant(state, 0, xp)
			return tx.Save(state)
		}
		return nil
	})
	return cleared, err
}

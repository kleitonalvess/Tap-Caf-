package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"coffe-mania/database/playerstate"
	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/roomcatalog"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

var errTableClean = errors.New("A mesa já está limpa.")
var errTableDirty = errors.New("Limpe a mesa antes de movê-la.")

// placedTable reports whether the unit is one of the owner's tables in the room.
func placedTable(app core.App, owner, unitID string) bool {
	unit, err := app.FindRecordById("player_inventory", unitID)
	if err != nil || unit.GetString("user") != owner || !unit.GetBool("placed") {
		return false
	}
	item, ok := roomcatalog.ByID(unit.GetInt("item_id"))
	return ok && item.Kind == "table"
}

// leavePlate records the dishes a customer leaves on a table; called inside the
// payment transaction, so every paid meal dirties its table exactly once.
func leavePlate(tx core.App, owner, tableID string) error {
	if tableID == "" || !placedTable(tx, owner, tableID) {
		return nil
	}
	collection, err := tx.FindCollectionByNameOrId("room_dirt")
	if err != nil {
		return err
	}
	plate := core.NewRecord(collection)
	plate.Set("user", owner)
	plate.Set("table_id", tableID)
	return tx.Save(plate)
}

// roomDirt groups the plates per table for the world snapshot.
func roomDirt(app core.App, owner string) ([]gamewire.Dirt, error) {
	plates, err := app.FindRecordsByFilter("room_dirt", "user={:owner}", "created", 0, 0, dbx.Params{"owner": owner})
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
		dirt = append(dirt, gamewire.Dirt{TableID: table, Plates: 1, Since: plate.GetDateTime("created").Time().UnixMilli()})
	}
	return dirt, nil
}

func tableIsDirty(tx core.App, owner, tableID string) (bool, error) {
	_, err := tx.FindFirstRecordByFilter("room_dirt", "user={:owner} && table_id={:table}", dbx.Params{"owner": owner, "table": tableID})
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// cleanTable clears every plate on the table; reward grants the owner the
// cleaning XP when the owner did it in person.
func cleanTable(app core.App, owner, tableID string, reward bool) (int, error) {
	cleared := 0
	err := app.RunInTransaction(func(tx core.App) error {
		if !placedTable(tx, owner, tableID) {
			return errRoomOwned
		}
		plates, err := tx.FindRecordsByFilter("room_dirt", "user={:owner} && table_id={:table}", "", 0, 0, dbx.Params{"owner": owner, "table": tableID})
		if err != nil {
			return err
		}
		if len(plates) == 0 {
			return errTableClean
		}
		for _, plate := range plates {
			if err = tx.Delete(plate); err != nil {
				return err
			}
		}
		cleared = len(plates)
		if xp := gamerules.Tables().CleaningXP; reward && xp > 0 {
			state, err := playerstate.GetOrCreate(tx, owner)
			if err != nil {
				return err
			}
			playerstate.Grant(state, 0, xp)
			return tx.Save(state)
		}
		return nil
	})
	return cleared, err
}

func registerTableRoutes(e *core.ServeEvent) {
	e.Router.POST("/api/coffe/room/tables/clean", func(r *core.RequestEvent) error {
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		if !strings.HasPrefix(r.Request.Header.Get("Content-Type"), "application/json") {
			return r.BadRequestError("Envie JSON.", nil)
		}
		var body struct {
			TableID string `json:"tableId"`
		}
		decoder := json.NewDecoder(r.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil || body.TableID == "" || len(body.TableID) > 40 {
			return r.BadRequestError("Mesa inválida.", nil)
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			return r.BadRequestError("Mesa inválida.", nil)
		}
		r.Response.Header().Set("Cache-Control", "no-store")
		command := map[string]string{"tableId": body.TableID}
		if roomService(r.App) != nil {
			return proxyRoomOperationAs(r, user.Id, user.Id, "table_clean", command)
		}
		data, _ := json.Marshal(command)
		result := persistenceOperation(r.App, gamewire.Operation{Owner: user.Id, User: user.Id, Action: "table_clean", Body: data})
		return r.JSON(result.Status, json.RawMessage(result.Body))
	}).Bind(apis.BodyLimit(512)).BindFunc(func(r *core.RequestEvent) error {
		// Cookie auth + mutation: require a browser same-origin Origin header.
		if r.Request.Header.Get("Origin") == "" {
			return r.ForbiddenError("Origem inválida.", nil)
		}
		return sameOrigin(r)
	})
}

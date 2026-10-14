package main

import (
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

var errExpansionMax = errors.New("Seu café já está no tamanho máximo.")
var errExpansionStep = errors.New("O tamanho do café mudou. Confira a próxima expansão.")
var errExpansionLevel = errors.New("Nível insuficiente para esta expansão. Use Grana ou suba de nível.")
var errExpansionCoins = errors.New("Moedas insuficientes para a expansão.")
var errExpansionCash = errors.New("Grana insuficiente para a expansão.")
var errExpansionPay = errors.New("Forma de pagamento inválida.")

// Starter structure: the wall segment and the floor used when none is placed.
const (
	wallSegmentID  = 3090000
	defaultFloorID = 3050000
)

// expansionResult answers the Expansão window; the room itself arrives in the
// room snapshot (and as a world event for everyone inside).
type expansionResult struct {
	Tiles       int          `json:"tiles"`
	Pay         string       `json:"pay"`
	Coins       int64        `json:"coins"`
	Cash        int64        `json:"cash"`
	RewardCoins int64        `json:"rewardCoins"`
	XP          int64        `json:"xp"`
	Level       int          `json:"level"`
	LevelUp     bool         `json:"levelUp,omitempty"`
	LevelReward int64        `json:"levelReward,omitempty"`
	Room        roomSnapshot `json:"room"`
}

// expandRoom buys the next step: coins once its level is reached, or cash at
// any level. tiles must name that step, so a repeated request never pays twice.
func expandRoom(app core.App, owner string, tiles int, pay string) (expansionResult, error) {
	result := expansionResult{Tiles: tiles, Pay: pay}
	if pay != "coins" && pay != "cash" {
		return result, errExpansionPay
	}
	if err := ensureRoom(app, owner); err != nil {
		return result, err
	}
	err := app.RunInTransaction(func(tx core.App) error {
		room, err := tx.FindFirstRecordByData("player_rooms", "user", owner)
		if err != nil {
			return err
		}
		oldX, oldY := room.GetInt("tiles_x"), room.GetInt("tiles_y")
		step, ok := gamerules.NextExpansion(max(oldX, oldY))
		if !ok {
			return errExpansionMax
		}
		if tiles != step.Tiles {
			return errExpansionStep
		}
		state, err := playerstate.GetOrCreate(tx, owner)
		if err != nil {
			return err
		}
		if pay == "coins" {
			if max(1, state.GetInt("level")) < step.Level {
				return errExpansionLevel
			}
			if state.GetInt64("gold") < step.Coins {
				return errExpansionCoins
			}
			state.Set("gold", state.GetInt64("gold")-step.Coins)
			result.Coins = step.Coins
		} else {
			if state.GetInt64("cash") < step.Cash {
				return errExpansionCash
			}
			state.Set("cash", state.GetInt64("cash")-step.Cash)
			result.Cash = step.Cash
		}
		reward := gamerules.Expansions().RewardCoins
		progress := playerstate.Grant(state, reward, step.XP)
		result.RewardCoins, result.XP = reward, step.XP
		result.Level, result.LevelUp, result.LevelReward = progress.Level, progress.LevelUp, progress.LevelReward
		if err := tx.Save(state); err != nil {
			return err
		}
		if err := extendStructure(tx, owner, oldX, oldY, step.Tiles); err != nil {
			return err
		}
		room.Set("tiles_x", step.Tiles)
		room.Set("tiles_y", step.Tiles)
		room.Set("revision", room.GetInt("revision")+1)
		return tx.Save(room)
	})
	if err != nil {
		return result, err
	}
	result.Room, err = snapshotRoom(app, owner)
	return result, err
}

// extendStructure gives the new tiles the café's current look: the most used
// floor, and on each back wall a segment with that wall's most used wallpaper
// (none when the owner took every wallpaper down). Walls stay on tx=0 and ty=0,
// so the room grows towards the front and nothing placed has to move.
func extendStructure(tx core.App, owner string, oldX, oldY, size int) error {
	units, err := tx.FindRecordsByFilter("player_inventory", "user={:user} && placed=true", "", 0, 0, dbx.Params{"user": owner})
	if err != nil {
		return err
	}
	floors := map[int]int{}
	papers := [2]map[int]int{{}, {}}
	for _, unit := range units {
		id := unit.GetInt("item_id")
		switch unit.GetString("layer") {
		case "floor":
			floors[id]++
		case "wallpaper":
			papers[unit.GetInt("rotation")%2][id]++
		}
	}
	floor := mostUsed(floors, defaultFloorID)
	paper := [2]int{mostUsed(papers[0], 0), mostUsed(papers[1], 0)}
	// One bare wall with a dressed other wall follows the dressed one.
	for side := range paper {
		if paper[side] == 0 {
			paper[side] = paper[1-side]
		}
	}
	inventory, err := tx.FindCollectionByNameOrId("player_inventory")
	if err != nil {
		return err
	}
	add := func(id, x, y, rotation int) error {
		item, ok := roomcatalog.ByID(id)
		if !ok {
			return errors.New("structure item missing")
		}
		unit := core.NewRecord(inventory)
		unit.Load(map[string]any{"user": owner, "item_id": id, "tx": x, "ty": y, "rotation": rotation, "placed": true, "layer": roomcatalog.Layer(item)})
		return tx.Save(unit)
	}
	wall := func(x, y, rotation int) error {
		if err := add(wallSegmentID, x, y, rotation); err != nil {
			return err
		}
		if id := paper[rotation]; id != 0 {
			return add(id, x, y, rotation)
		}
		return nil
	}
	for y := oldY; y < size; y++ {
		if err := wall(0, y, 0); err != nil {
			return err
		}
	}
	for x := oldX; x < size; x++ {
		if err := wall(x, 0, 1); err != nil {
			return err
		}
	}
	for y := 1; y < size; y++ {
		for x := 1; x < size; x++ {
			if x < oldX && y < oldY {
				continue
			}
			if err := add(floor, x, y, 0); err != nil {
				return err
			}
		}
	}
	return nil
}

// mostUsed picks the most frequent id (the lowest on a tie, for stable results).
func mostUsed(counts map[int]int, fallback int) int {
	best, bestCount := fallback, 0
	for id, count := range counts {
		if count > bestCount || count == bestCount && id < best {
			best, bestCount = id, count
		}
	}
	return best
}

func registerExpansionRoutes(e *core.ServeEvent) {
	e.Router.POST("/api/coffe/room/expand", func(r *core.RequestEvent) error {
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		if !strings.HasPrefix(r.Request.Header.Get("Content-Type"), "application/json") {
			return r.BadRequestError("Envie JSON.", nil)
		}
		var body struct {
			Tiles int    `json:"tiles"`
			Pay   string `json:"pay"`
		}
		decoder := json.NewDecoder(r.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil || body.Tiles < 1 || body.Tiles > gamerules.MaxRoomTiles || (body.Pay != "coins" && body.Pay != "cash") {
			return r.BadRequestError("Expansão inválida.", nil)
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			return r.BadRequestError("Expansão inválida.", nil)
		}
		r.Response.Header().Set("Cache-Control", "no-store")
		if roomService(r.App) != nil {
			return proxyRoomOperationAs(r, user.Id, user.Id, "room_expand", body)
		}
		data, _ := json.Marshal(body)
		result := persistenceOperation(r.App, gamewire.Operation{Owner: user.Id, User: user.Id, Action: "room_expand", Body: data})
		return r.JSON(result.Status, json.RawMessage(result.Body))
	}).Bind(apis.BodyLimit(512)).BindFunc(func(r *core.RequestEvent) error {
		// Cookie auth + mutation: require a browser same-origin Origin header.
		if r.Request.Header.Get("Origin") == "" {
			return r.ForbiddenError("Origem inválida.", nil)
		}
		return sameOrigin(r)
	})
}

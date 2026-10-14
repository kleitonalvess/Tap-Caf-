package main

import (
	"encoding/json"
	"errors"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

var errFarmGrowing = errors.New("A horta ainda está crescendo. Volte quando a colheita estiver pronta.")
var errFarmFull = errors.New("Use os ingredientes frescos numa receita antes de colher de novo.")
var errPartyOn = errors.New("A festa já está rolando!")
var errPartyResting = errors.New("O pessoal ainda está descansando da última festa.")

func unixMs(t types.DateTime) int64 {
	if t.IsZero() {
		return 0
	}
	return t.Time().UnixMilli()
}

// streetState derives the farm and disco timers from the instants stored on
// the room; nothing is decremented over time.
func streetState(room *core.Record) gamewire.Street {
	s := gamewire.Street{FreshCharges: room.GetInt("fresh_charges")}
	if harvested := room.GetDateTime("farm_harvested_at"); !harvested.IsZero() {
		s.FarmReadyAt = unixMs(harvested.Add(gamerules.FarmCooldown()))
	}
	if started := room.GetDateTime("party_started_at"); !started.IsZero() {
		ends := started.Add(gamerules.PartyDuration())
		s.PartyStartedAt = unixMs(started)
		s.PartyEndsAt = unixMs(ends)
		s.PartyReadyAt = unixMs(ends.Add(gamerules.PartyCooldown()))
	}
	return s
}

// partyActive tells the payment transaction whether customers tip a party bonus.
func partyActive(room *core.Record, now time.Time) bool {
	s := streetState(room)
	return s.PartyActive(now.UnixMilli())
}

// harvestFarm picks the fresh ingredients: one charge for the next batch,
// once per cooldown, never more than the farm can hold.
func harvestFarm(app core.App, owner string, now types.DateTime) (gamewire.Street, error) {
	var state gamewire.Street
	if err := ensureRoom(app, owner); err != nil {
		return state, err
	}
	err := app.RunInTransaction(func(tx core.App) error {
		room, err := tx.FindFirstRecordByData("player_rooms", "user", owner)
		if err != nil {
			return err
		}
		current := streetState(room)
		if current.FarmReadyAt > now.Time().UnixMilli() {
			return errFarmGrowing
		}
		farm := gamerules.Street().Farm
		if current.FreshCharges >= farm.MaxCharges {
			return errFarmFull
		}
		room.Set("farm_harvested_at", now)
		room.Set("fresh_charges", current.FreshCharges+1)
		if err := tx.Save(room); err != nil {
			return err
		}
		state = streetState(room)
		return nil
	})
	return state, err
}

// startParty opens the disco: customers come more often and tip more until
// the party ends; the next one waits for the cooldown after that.
func startParty(app core.App, owner string, now types.DateTime) (gamewire.Street, error) {
	var state gamewire.Street
	if err := ensureRoom(app, owner); err != nil {
		return state, err
	}
	err := app.RunInTransaction(func(tx core.App) error {
		room, err := tx.FindFirstRecordByData("player_rooms", "user", owner)
		if err != nil {
			return err
		}
		current := streetState(room)
		at := now.Time().UnixMilli()
		if current.PartyActive(at) {
			return errPartyOn
		}
		if current.PartyReadyAt > at {
			return errPartyResting
		}
		room.Set("party_started_at", now)
		if err := tx.Save(room); err != nil {
			return err
		}
		state = streetState(room)
		return nil
	})
	return state, err
}

// registerStreetRoutes: owner-only actions on the street buildings. They go
// through the room service, so everyone inside sees the party start.
func registerStreetRoutes(e *core.ServeEvent) {
	for path, action := range map[string]string{"/api/coffe/street/farm/harvest": "farm_harvest", "/api/coffe/street/disco/party": "party_start"} {
		e.Router.POST(path, func(r *core.RequestEvent) error {
			user := sessionRecord(r)
			if user == nil {
				return r.UnauthorizedError("Entre para jogar.", nil)
			}
			r.Response.Header().Set("Cache-Control", "no-store")
			if roomService(r.App) != nil {
				return proxyRoomOperationAs(r, user.Id, user.Id, action, map[string]string{})
			}
			result := persistenceOperation(r.App, gamewire.Operation{Owner: user.Id, User: user.Id, Action: action, Body: json.RawMessage(`{}`)})
			return r.JSON(result.Status, json.RawMessage(result.Body))
		}).Bind(apis.BodyLimit(256)).BindFunc(func(r *core.RequestEvent) error {
			// Cookie auth + mutation: require a browser same-origin Origin header.
			if r.Request.Header.Get("Origin") == "" {
				return r.ForbiddenError("Origem inválida.", nil)
			}
			return sameOrigin(r)
		})
	}
}

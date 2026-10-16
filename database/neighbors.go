package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"coffe-mania/shared/cafe"
	"coffe-mania/shared/gamerules"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// ensureNeighborUser creates the user of a non-player neighbour on its first
// visit: the record id is the neighbour's id, the email is not deliverable and
// the password is random and never kept, so nobody can sign in as it.
func ensureNeighborUser(app core.App, id string) error {
	if _, err := app.FindRecordById("users", id); err == nil {
		return nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	neighbor, ok := gamerules.NeighborByID(id)
	if !ok {
		return cafe.ErrNotNeighbor
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	secret := make([]byte, 24)
	if _, err := rand.Read(secret); err != nil {
		return err
	}
	record := core.NewRecord(users)
	record.Id = id
	record.SetEmail(id + "@vizinhos.invalid")
	record.SetPassword(hex.EncodeToString(secret))
	record.Set("name", neighbor.Name)
	return app.Save(record)
}

// prepareRoomOwner makes a non-player neighbour's café ready before a visit;
// any other owner must already be a user.
func prepareRoomOwner(app core.App, owner string) error {
	if _, npc := gamerules.NeighborByID(owner); npc {
		if err := ensureNeighborUser(app, owner); err != nil {
			return err
		}
		return cafe.EnsureNeighborCafe(pb(app), owner, time.Now())
	}
	_, err := app.FindRecordById("users", owner)
	return err
}

func neighborFailure(r *core.RequestEvent, err error) error {
	status, message := cafe.NeighborErrorStatus(err)
	if status == http.StatusInternalServerError {
		return r.InternalServerError(message, err)
	}
	return apis.NewApiError(status, message, nil)
}

func registerNeighborRoutes(e *core.ServeEvent) {
	mutation := func(r *core.RequestEvent) error {
		if r.Request.Header.Get("Origin") == "" {
			return r.ForbiddenError("Origem inválida.", nil)
		}
		return sameOrigin(r)
	}
	e.Router.GET("/api/coffe/neighbors", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		neighbors, err := cafe.ListNeighbors(pb(r.App), user.Id, time.Now())
		if err != nil {
			return r.InternalServerError("Não foi possível carregar os vizinhos.", err)
		}
		return r.JSON(http.StatusOK, neighbors)
	})
	e.Router.GET("/api/coffe/gifts", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		gifts, err := cafe.SnapshotGifts(pb(r.App), user.Id, time.Now())
		if err != nil {
			return r.InternalServerError("Não foi possível carregar os presentes.", err)
		}
		return r.JSON(http.StatusOK, gifts)
	})
	e.Router.POST("/api/coffe/gifts/send", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		var body struct {
			To   string `json:"to"`
			Item string `json:"item"`
		}
		decoder := json.NewDecoder(r.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil || decoder.Decode(new(any)) != io.EOF || body.To == "" || len(body.To) > 15 || len(body.Item) > 40 {
			return r.BadRequestError("Presente inválido.", nil)
		}
		gifts, err := cafe.SendGift(pb(r.App), user.Id, body.To, body.Item, time.Now())
		if err != nil {
			return neighborFailure(r, err)
		}
		return r.JSON(http.StatusOK, gifts)
	}).Bind(apis.BodyLimit(256)).BindFunc(mutation)
	e.Router.POST("/api/coffe/gifts/claim", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		var body struct {
			ID string `json:"id"`
		}
		decoder := json.NewDecoder(r.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil || decoder.Decode(new(any)) != io.EOF || body.ID == "" || len(body.ID) > 40 {
			return r.BadRequestError("Presente inválido.", nil)
		}
		claim, err := cafe.ClaimGift(pb(r.App), user.Id, body.ID, time.Now())
		if err != nil {
			return neighborFailure(r, err)
		}
		return r.JSON(http.StatusOK, claim)
	}).Bind(apis.BodyLimit(256)).BindFunc(mutation)
	// A visitor cheers a waiting customer up in a neighbour's café: the room
	// checks the customer, persistence pays the help.
	e.Router.POST("/api/coffe/room/cheer", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		var body struct {
			RoomID  string `json:"roomId"`
			ActorID string `json:"actorId"`
		}
		decoder := json.NewDecoder(r.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil || decoder.Decode(new(any)) != io.EOF || body.RoomID == "" || body.RoomID == user.Id || body.ActorID == "" || len(body.ActorID) > 80 {
			return r.BadRequestError("Pedido inválido.", nil)
		}
		if roomService(r.App) == nil {
			return apis.NewApiError(http.StatusServiceUnavailable, "O café do vizinho está fechado agora.", nil)
		}
		return proxyRoomOperationAs(r, body.RoomID, user.Id, "npc_cheer", map[string]string{"actorId": body.ActorID})
	}).Bind(apis.BodyLimit(256)).BindFunc(mutation)
}

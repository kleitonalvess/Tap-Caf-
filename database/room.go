package main

import (
	"coffe-mania/shared/cafe"

	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"coffe-mania/database/playerstate"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func registerRoomRoutes(e *core.ServeEvent) {
	group := e.Router.Group("/api/coffe/room")
	group.BindFunc(func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		return r.Next()
	})
	group.GET("", func(r *core.RequestEvent) error {
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		owner := r.Request.URL.Query().Get("room")
		if owner == "" {
			owner = user.Id
		}
		if err := prepareRoomOwner(r.App, user.Id, owner); err != nil {
			return r.NotFoundError("Quarto não encontrado.", nil)
		}
		if err := ensureRoom(r.App, owner); err != nil {
			return r.InternalServerError("Não foi possível carregar o quarto.", err)
		}
		var snapshot roomSnapshot
		err := r.App.RunInTransaction(func(tx core.App) error { var err error; snapshot, err = snapshotRoom(tx, owner); return err })
		if err != nil {
			return r.InternalServerError("Não foi possível carregar o inventário.", err)
		}
		if owner != user.Id {
			snapshot.CanEdit = false
			snapshot.AwaySummary = nil
			snapshot.TipJar = nil
			placed := []roomUnit{}
			for _, u := range snapshot.Inventory {
				if u.Placed {
					placed = append(placed, u)
				}
			}
			snapshot.Inventory = placed
			state, err := playerstate.GetOrCreate(r.App, user.Id)
			if err != nil {
				return err
			}
			snapshot.PlayerState = playerstate.View(state)
		}
		return r.JSON(http.StatusOK, snapshot)
	})
	// The owner saw the "Bem-vindo de volta!" summary.
	group.POST("/away/ack", func(r *core.RequestEvent) error {
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		if err := acknowledgeAway(r.App, user.Id); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return r.InternalServerError("Não foi possível salvar.", err)
		}
		return r.JSON(http.StatusOK, map[string]bool{"ok": true})
	}).Bind(apis.BodyLimit(256)).BindFunc(func(r *core.RequestEvent) error {
		if r.Request.Header.Get("Origin") == "" {
			return r.ForbiddenError("Origem inválida.", nil)
		}
		return sameOrigin(r)
	})
	for _, operation := range []string{"purchase", "move", "store", "sell"} {
		action := operation
		group.POST("/"+action, func(r *core.RequestEvent) error {
			user := sessionRecord(r)
			if user == nil {
				return r.UnauthorizedError("Entre para jogar.", nil)
			}
			if !strings.HasPrefix(r.Request.Header.Get("Content-Type"), "application/json") {
				return r.BadRequestError("Envie JSON.", nil)
			}
			var command roomCommand
			decoder := json.NewDecoder(r.Request.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&command); err != nil {
				return r.BadRequestError("Pedido inválido.", nil)
			}
			if err := decoder.Decode(new(any)); err != io.EOF || command.Revision == nil || *command.Revision < 1 || !requestKeyPattern.MatchString(command.RequestID) ||
				((action == "purchase" || action == "move") && (command.TX == nil || command.TY == nil || command.Rotation == nil)) ||
				(action == "purchase" && (command.ItemID <= 0 || command.UnitID != "")) || (action != "purchase" && (command.UnitID == "" || command.ItemID != 0)) {
				return r.BadRequestError("Pedido inválido.", nil)
			}
			if err := ensureRoom(r.App, user.Id); err != nil {
				return r.InternalServerError("Não foi possível preparar o inventário.", err)
			}
			if roomService(r.App) != nil {
				return proxyRoomOperation(r, user.Id, action, command)
			}
			snapshot, err := mutateRoom(r.App, user.Id, action, command)
			if err != nil {
				// The same statuses and messages as the room service (cafe.ErrorStatus).
				status, message := cafe.ErrorStatus(err)
				if status >= 500 {
					return r.InternalServerError("Não foi possível salvar esta operação.", err)
				}
				return apis.NewApiError(status, message, nil)
			}
			return r.JSON(http.StatusOK, snapshot)
		}).Bind(apis.BodyLimit(2048)).BindFunc(func(r *core.RequestEvent) error {
			if r.Request.Header.Get("Origin") == "" {
				return r.ForbiddenError("Origem inválida.", nil)
			}
			return sameOrigin(r)
		})
	}
}

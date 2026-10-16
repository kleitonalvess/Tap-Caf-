package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"coffe-mania/shared/cafe"
	"coffe-mania/shared/gamewire"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// registerMachineRoutes: the owner's entertainment machines. Actions pass
// through the room service, so the room knows when a machine runs (it lifts
// the customers' patience) and visitors see it.
func registerMachineRoutes(e *core.ServeEvent) {
	e.Router.GET("/api/coffe/machines", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		machines, err := cafe.SnapshotMachines(pb(r.App), user.Id, time.Now())
		if err != nil {
			return r.InternalServerError("Não foi possível carregar as máquinas.", err)
		}
		return r.JSON(http.StatusOK, map[string]any{"machines": machines})
	})
	for path, action := range cafe.MachineActions {
		e.Router.POST(path, func(r *core.RequestEvent) error {
			r.Response.Header().Set("Cache-Control", "no-store")
			user := sessionRecord(r)
			if user == nil {
				return r.UnauthorizedError("Entre para jogar.", nil)
			}
			if !strings.HasPrefix(r.Request.Header.Get("Content-Type"), "application/json") {
				return r.BadRequestError("Envie JSON.", nil)
			}
			var body struct {
				UnitID string `json:"unitId"`
			}
			decoder := json.NewDecoder(r.Request.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&body); err != nil || decoder.Decode(new(any)) != io.EOF || body.UnitID == "" || len(body.UnitID) > 40 {
				return r.BadRequestError("Máquina inválida.", nil)
			}
			command := map[string]string{"unitId": body.UnitID}
			if roomService(r.App) != nil {
				return proxyRoomOperationAs(r, user.Id, user.Id, action, command)
			}
			data, _ := json.Marshal(command)
			result := persistenceOperation(r.App, gamewire.Operation{Owner: user.Id, User: user.Id, Action: action, Body: data})
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

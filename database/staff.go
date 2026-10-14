package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"coffe-mania/shared/cafe"
	"coffe-mania/shared/gamewire"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func registerStaffRoutes(e *core.ServeEvent) {
	g := e.Router.Group("/api/coffe/staff")
	g.BindFunc(func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		return r.Next()
	})
	g.GET("", func(r *core.RequestEvent) error {
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		snapshot, err := snapshotStaff(r.App, user.Id)
		if err != nil {
			return r.InternalServerError("Não foi possível carregar os funcionários.", err)
		}
		return r.JSON(http.StatusOK, snapshot)
	})
	for path, action := range cafe.StaffActions {
		action := action
		g.POST("/"+path, func(r *core.RequestEvent) error {
			user := sessionRecord(r)
			if user == nil {
				return r.UnauthorizedError("Entre para jogar.", nil)
			}
			if !strings.HasPrefix(r.Request.Header.Get("Content-Type"), "application/json") {
				return r.BadRequestError("Envie JSON.", nil)
			}
			var body struct {
				ProfileID string `json:"profileId,omitempty"`
				StaffID   string `json:"staffId,omitempty"`
				Role      string `json:"role,omitempty"`
			}
			decoder := json.NewDecoder(r.Request.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&body); err != nil {
				return r.BadRequestError("Pedido inválido.", nil)
			}
			if err := decoder.Decode(new(any)); err != io.EOF || len(body.ProfileID) > 40 || len(body.StaffID) > 40 {
				return r.BadRequestError("Pedido inválido.", nil)
			}
			command := map[string]string{"profileId": body.ProfileID, "staffId": body.StaffID, "role": body.Role}
			if roomService(r.App) != nil {
				return proxyRoomOperationAs(r, user.Id, user.Id, action, command)
			}
			data, _ := json.Marshal(command)
			result := persistenceOperation(r.App, gamewire.Operation{Owner: user.Id, User: user.Id, Action: action, Body: data})
			return r.JSON(result.Status, json.RawMessage(result.Body))
		}).Bind(apis.BodyLimit(512)).BindFunc(func(r *core.RequestEvent) error {
			// Cookie auth + mutation: require a browser same-origin Origin header.
			if r.Request.Header.Get("Origin") == "" {
				return r.ForbiddenError("Origem inválida.", nil)
			}
			return sameOrigin(r)
		})
	}
}

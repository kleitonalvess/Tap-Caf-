package main

import (
	"encoding/json"
	"io"
	"strings"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

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

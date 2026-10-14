package main

import (
	"encoding/json"
	"io"
	"strings"

	"coffe-mania/shared/gamewire"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

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

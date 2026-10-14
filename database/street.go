package main

import (
	"encoding/json"

	"coffe-mania/shared/cafe"
	"coffe-mania/shared/gamewire"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// registerStreetRoutes: owner-only actions on the street buildings. They go
// through the room service, so everyone inside sees the party start.
func registerStreetRoutes(e *core.ServeEvent) {
	for path, action := range cafe.StreetActions {
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

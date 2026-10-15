package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"coffe-mania/shared/cafe"
	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func registerCookingRoutes(e *core.ServeEvent) {
	e.Router.GET("/api/coffe/rules", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-cache")
		return r.JSON(http.StatusOK, gamerules.Public())
	})
	g := e.Router.Group("/api/coffe/cooking")
	g.BindFunc(func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		return r.Next()
	})
	g.GET("", func(r *core.RequestEvent) error {
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		if err := ensureStarterStove(r.App, user.Id); err != nil {
			return r.InternalServerError("Não foi possível carregar os fogões.", err)
		}
		owner := r.Request.URL.Query().Get("room")
		if owner == "" {
			owner = user.Id
		}
		if _, err := r.App.FindRecordById("users", owner); err != nil {
			return r.NotFoundError("Quarto não encontrado.", nil)
		}
		snapshot, err := snapshotCooking(r.App, owner, types.NowDateTime())
		if err != nil {
			return r.InternalServerError("Não foi possível carregar o preparo.", err)
		}
		if owner != user.Id {
			snapshot.EmergencyRecipeID = ""
		}
		return r.JSON(http.StatusOK, snapshot)
	})
	for _, route := range cafe.CookingActions {
		route := route
		g.POST("/"+route.Path, func(r *core.RequestEvent) error {
			user := sessionRecord(r)
			if user == nil {
				return r.UnauthorizedError("Entre para jogar.", nil)
			}
			if !strings.HasPrefix(r.Request.Header.Get("Content-Type"), "application/json") {
				return r.BadRequestError("Envie JSON.", nil)
			}
			var body struct {
				StoveID  string `json:"stoveId"`
				RecipeID string `json:"recipeId,omitempty"`
				RoomID   string `json:"roomId,omitempty"`
			}
			decoder := json.NewDecoder(r.Request.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&body); err != nil {
				return r.BadRequestError("Pedido inválido.", nil)
			}
			if err := decoder.Decode(new(any)); err != io.EOF || body.StoveID == "" {
				return r.BadRequestError("Fogão inválido.", nil)
			}
			_, knownRecipe := gamerules.RecipeByID(body.RecipeID)
			if route.Action == "cook_start" && !knownRecipe || route.Action != "cook_start" && body.RecipeID != "" {
				return r.BadRequestError("Fogão ou receita inválidos.", nil)
			}
			owner := user.Id
			if body.RoomID != "" && body.RoomID != user.Id {
				if !route.Visitors {
					return r.ForbiddenError("Somente o dono pode alterar o quarto.", nil)
				}
				if _, err := r.App.FindRecordById("users", body.RoomID); err != nil {
					return r.NotFoundError("Quarto não encontrado.", nil)
				}
				owner = body.RoomID
			}
			command := map[string]string{"stoveId": body.StoveID}
			if body.RecipeID != "" {
				command["recipeId"] = body.RecipeID
			}
			if roomService(r.App) != nil {
				return proxyRoomOperationAs(r, owner, user.Id, route.Action, command)
			}
			data, _ := json.Marshal(command)
			result := persistenceOperation(r.App, gamewire.Operation{Owner: owner, User: user.Id, Action: route.Action, Body: data})
			return r.JSON(result.Status, json.RawMessage(result.Body))
		}).Bind(apis.BodyLimit(1024)).BindFunc(func(r *core.RequestEvent) error {
			// Cookie auth + mutation: require a browser same-origin Origin header.
			if r.Request.Header.Get("Origin") == "" {
				return r.ForbiddenError("Origem inválida.", nil)
			}
			return sameOrigin(r)
		})
	}
}

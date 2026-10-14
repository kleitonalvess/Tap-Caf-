package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"coffe-mania/shared/cafe"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// registerRewardRoutes: the daily bonus and the mail. Both only touch the
// player's own state, so they run here, without the room service.
func registerRewardRoutes(e *core.ServeEvent) {
	mutation := func(r *core.RequestEvent) error {
		// Cookie auth + mutation: require a browser same-origin Origin header.
		if r.Request.Header.Get("Origin") == "" {
			return r.ForbiddenError("Origem inválida.", nil)
		}
		return sameOrigin(r)
	}
	e.Router.GET("/api/coffe/daily", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		daily, err := cafe.Daily(pb(r.App), user.Id, time.Now())
		if err != nil {
			return r.InternalServerError("Não foi possível carregar o bônus diário.", err)
		}
		return r.JSON(http.StatusOK, daily)
	})
	e.Router.POST("/api/coffe/daily/claim", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		claim, err := cafe.ClaimDaily(pb(r.App), user.Id, time.Now())
		if errors.Is(err, cafe.ErrDailyClaimed) {
			return apis.NewApiError(http.StatusConflict, err.Error(), nil)
		}
		if err != nil {
			return r.InternalServerError("Não foi possível coletar o bônus.", err)
		}
		return r.JSON(http.StatusOK, claim)
	}).Bind(apis.BodyLimit(256)).BindFunc(mutation)
	e.Router.GET("/api/coffe/mail", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		mail, err := cafe.SnapshotMail(pb(r.App), user.Id)
		if err != nil {
			return r.InternalServerError("Não foi possível carregar o correio.", err)
		}
		return r.JSON(http.StatusOK, mail)
	})
	e.Router.POST("/api/coffe/mail/claim", func(r *core.RequestEvent) error {
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
		if err := decoder.Decode(&body); err != nil || body.ID == "" || len(body.ID) > 40 || decoder.Decode(new(any)) != io.EOF {
			return r.BadRequestError("Carta inválida.", nil)
		}
		claim, err := cafe.ClaimLetter(pb(r.App), user.Id, body.ID, time.Now())
		switch {
		case errors.Is(err, cafe.ErrMailMissing):
			return r.NotFoundError(err.Error(), nil)
		case errors.Is(err, cafe.ErrMailClaimed):
			return apis.NewApiError(http.StatusConflict, err.Error(), nil)
		case err != nil:
			return r.InternalServerError("Não foi possível abrir a carta.", err)
		}
		return r.JSON(http.StatusOK, claim)
	}).Bind(apis.BodyLimit(256)).BindFunc(mutation)
}

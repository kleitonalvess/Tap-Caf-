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
	e.Router.GET("/api/coffe/progress", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		progress, err := cafe.SnapshotProgress(pb(r.App), user.Id, time.Now())
		if err != nil {
			return r.InternalServerError("Não foi possível carregar as conquistas.", err)
		}
		return r.JSON(http.StatusOK, progress)
	})
	e.Router.POST("/api/coffe/progress/claim", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		var body struct {
			Kind string `json:"kind"`
			ID   string `json:"id"`
		}
		decoder := json.NewDecoder(r.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil || body.ID == "" || len(body.ID) > 40 || decoder.Decode(new(any)) != io.EOF {
			return r.BadRequestError("Prêmio inválido.", nil)
		}
		claim, err := claimProgress(pb(r.App), user.Id, body.Kind, body.ID)
		if err != nil {
			status, message := progressError(err)
			if status == http.StatusInternalServerError {
				return r.InternalServerError(message, err)
			}
			return apis.NewApiError(status, message, nil)
		}
		return r.JSON(http.StatusOK, claim)
	}).Bind(apis.BodyLimit(256)).BindFunc(mutation)
	e.Router.POST("/api/coffe/cafe/name", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		var body struct {
			Name string `json:"name"`
		}
		decoder := json.NewDecoder(r.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil || decoder.Decode(new(any)) != io.EOF {
			return r.BadRequestError("Nome inválido.", nil)
		}
		// The cookie names the café: a player only ever renames their own.
		state, err := cafe.RenameCafe(pb(r.App), user.Id, body.Name)
		if errors.Is(err, cafe.ErrCafeName) {
			return r.BadRequestError(err.Error(), nil)
		}
		if err != nil {
			return r.InternalServerError("Não foi possível renomear o café.", err)
		}
		return r.JSON(http.StatusOK, state)
	}).Bind(apis.BodyLimit(512)).BindFunc(mutation)
}

// claimProgress pays an achievement tier ("achievement") or a daily mission ("mission").
func claimProgress(s cafe.Store, user, kind, id string) (cafe.ProgressClaim, error) {
	switch kind {
	case "achievement":
		return cafe.ClaimAchievement(s, user, id, time.Now())
	case "mission":
		return cafe.ClaimMission(s, user, id, time.Now())
	}
	return cafe.ProgressClaim{}, cafe.ErrRewardMissing
}

func progressError(err error) (int, string) {
	switch {
	case errors.Is(err, cafe.ErrRewardMissing):
		return http.StatusNotFound, err.Error()
	case errors.Is(err, cafe.ErrRewardClaimed):
		return http.StatusConflict, err.Error()
	case errors.Is(err, cafe.ErrRewardLocked):
		return http.StatusConflict, err.Error()
	}
	return http.StatusInternalServerError, "Não foi possível resgatar o prêmio."
}

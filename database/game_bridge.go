package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"

	"coffe-mania/database/playerstate"
	"coffe-mania/shared/cafe"
	"coffe-mania/shared/gamewire"
	"github.com/google/uuid"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

type roomServiceClient struct {
	URL, Secret string
	HTTP        *http.Client
}

func roomService(app core.App) *roomServiceClient {
	client, _ := app.Store().Get("roomService").(*roomServiceClient)
	return client
}
func (c *roomServiceClient) request(ctx context.Context, path string, body, out any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", c.URL+"/internal/"+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.Secret)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("room service %s: HTTP %d", path, res.StatusCode)
	}
	if out != nil {
		return json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(out)
	}
	return nil
}
func proxyRoomOperation(r *core.RequestEvent, userID, action string, body any) error {
	return proxyRoomOperationAs(r, userID, userID, action, body)
}

// proxyRoomOperationAs runs an operation in owner's room on behalf of user;
// both services still check which actions a visitor may perform.
func proxyRoomOperationAs(r *core.RequestEvent, owner, user, action string, body any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	var result gamewire.Result
	ctx, cancel := context.WithTimeout(r.Request.Context(), 12*time.Second)
	defer cancel()
	err = roomService(r.App).request(ctx, "operation", gamewire.Operation{Owner: owner, User: user, Action: action, Body: data}, &result)
	if err != nil {
		r.App.Logger().Warn("Falha ao comunicar uma operação do quarto", "action", action, "room", owner, "error", err)
		return apis.NewApiError(503, "O serviço do quarto está indisponível. Tente novamente.", nil)
	}
	return r.JSON(result.Status, json.RawMessage(result.Body))
}
func registerGameBridge(e *core.ServeEvent) error {
	secret, err := gamewire.Secret(true)
	if err != nil {
		return err
	}
	target := os.Getenv("COFFE_GAME_URL")
	if target == "" {
		target = "http://127.0.0.1:8091"
	}
	target = strings.TrimRight(target, "/")
	client := &roomServiceClient{target, secret, &http.Client{Timeout: 12 * time.Second}}
	e.App.Store().Set("roomService", client)
	// A persistence restart invalidates old activity markers; the service renews presence.
	if _, err = e.App.DB().NewQuery("UPDATE player_rooms SET active = false, human_count = 0").Execute(); err != nil {
		return err
	}
	upstream, err := url.Parse(target)
	if err != nil {
		return err
	}
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	e.Router.GET("/game/{path...}", func(r *core.RequestEvent) error { proxy.ServeHTTP(r.Response, r.Request); return nil })
	e.Router.POST("/api/coffe/game-ticket", func(r *core.RequestEvent) error {
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		var body struct {
			RoomID string `json:"roomId"`
		}
		if r.BindBody(&body) != nil {
			return r.BadRequestError("Quarto inválido.", nil)
		}
		owner := body.RoomID
		if owner == "" {
			owner = user.Id
		}
		// A non-player neighbour's café is made ready (user, room, chores) on the visit.
		if err := prepareRoomOwner(r.App, owner); err != nil {
			return r.NotFoundError("Quarto não encontrado.", nil)
		}
		if err := ensureRoom(r.App, owner); err != nil {
			return r.InternalServerError("Quarto indisponível.", err)
		}
		state, err := playerstate.GetOrCreate(r.App, user.Id)
		if err != nil {
			return err
		}
		ticket := gamewire.Ticket{Nonce: uuid.NewString(), Room: owner, User: user.Id, Name: sessionView(user).DisplayName, Appearance: state.GetString("appearance"), Expires: time.Now().Add(time.Minute).Unix()}
		return r.JSON(200, map[string]any{"ticket": gamewire.SignTicket(secret, ticket), "roomId": owner, "canEdit": owner == user.Id})
	}).Bind(apis.BodyLimit(1024)).BindFunc(func(r *core.RequestEvent) error {
		if r.Request.Header.Get("Origin") == "" {
			return r.ForbiddenError("Origem inválida.", nil)
		}
		return sameOrigin(r)
	})
	group := e.Router.Group("/api/coffe/game-internal")
	group.BindFunc(func(r *core.RequestEvent) error {
		if subtle.ConstantTimeCompare([]byte(r.Request.Header.Get("Authorization")), []byte("Bearer "+secret)) != 1 {
			return r.ForbiddenError("Acesso restrito.", nil)
		}
		r.Response.Header().Set("Cache-Control", "no-store")
		return r.Next()
	})
	group.GET("/{owner}/load", func(r *core.RequestEvent) error {
		// Waking replays the absence first, so the seed's world already has it.
		seed, err := cafe.LoadSeed(pb(r.App), r.Request.PathValue("owner"), time.Now())
		if err != nil {
			return err
		}
		return r.JSON(200, seed)
	})
	group.POST("/{owner}/active", func(r *core.RequestEvent) error {
		var body struct {
			Active bool `json:"active"`
			Humans int  `json:"humans"`
		}
		if r.BindBody(&body) != nil || body.Humans < 0 || body.Humans > 64 {
			return r.BadRequestError("Inválido.", nil)
		}
		_, err := r.App.DB().NewQuery("UPDATE player_rooms SET active={:active}, human_count={:humans}, last_active={:now} WHERE user={:owner}").Bind(dbx.Params{"active": body.Active, "humans": body.Humans, "now": types.NowDateTime(), "owner": r.Request.PathValue("owner")}).Execute()
		if err != nil {
			return err
		}
		return r.JSON(200, map[string]bool{"ok": true})
	})
	group.POST("/{owner}/sleep", func(r *core.RequestEvent) error {
		var body gamewire.Sleep
		if r.BindBody(&body) != nil {
			return r.BadRequestError("Inválido.", nil)
		}
		if err := saveDormantRoom(r.App, r.Request.PathValue("owner"), body); err != nil {
			return err
		}
		return r.JSON(200, map[string]bool{"ok": true})
	}).Bind(apis.BodyLimit(131072))
	group.POST("/{owner}/operation", func(r *core.RequestEvent) error {
		var op gamewire.Operation
		if r.BindBody(&op) != nil || op.Owner != r.Request.PathValue("owner") {
			return r.BadRequestError("Inválido.", nil)
		}
		return r.JSON(200, persistenceOperation(r.App, op))
	}).Bind(apis.BodyLimit(4096))
	group.POST("/{owner}/consume", func(r *core.RequestEvent) error {
		var body struct {
			FoodID  string `json:"foodId"`
			TableID string `json:"tableId"`
			// The room confirms a waiter handed the dish over: the customer tips.
			Waiter bool `json:"waiter"`
			// A special visitor (gamerules.Visitor id) pays its bonus.
			VIP string `json:"vip"`
		}
		if r.BindBody(&body) != nil || body.FoodID == "" {
			return r.BadRequestError("Inválido.", nil)
		}
		payment, err := serveCustomerAs(r.App, r.Request.PathValue("owner"), body.FoodID, body.TableID, gamewire.ServeOptions{Waiter: body.Waiter, VIP: body.VIP})
		if errors.Is(err, errFoodGone) {
			return r.NotFoundError("Prato indisponível.", nil)
		}
		if err != nil {
			return err
		}
		return r.JSON(200, payment)
	})
	// Staff clear tables without the owner's reward; the room has already
	// checked that the employee stands beside the table.
	group.POST("/{owner}/clean-table", func(r *core.RequestEvent) error {
		var body struct {
			TableID string `json:"tableId"`
		}
		if r.BindBody(&body) != nil || body.TableID == "" {
			return r.BadRequestError("Inválido.", nil)
		}
		plates, err := cleanTable(r.App, r.Request.PathValue("owner"), body.TableID, false)
		switch {
		case errors.Is(err, errTableClean):
			return r.JSON(409, map[string]string{"message": err.Error()})
		case errors.Is(err, errRoomOwned):
			return r.NotFoundError("Mesa indisponível.", nil)
		case err != nil:
			return err
		}
		return r.JSON(200, map[string]int{"plates": plates})
	})
	group.POST("/{owner}/feedback", func(r *core.RequestEvent) error {
		var body struct {
			Satisfied bool `json:"satisfied"`
		}
		if r.BindBody(&body) != nil {
			return r.BadRequestError("Inválido.", nil)
		}
		popularity, err := recordVerdict(r.App, r.Request.PathValue("owner"), body.Satisfied)
		if err != nil {
			return err
		}
		return r.JSON(200, map[string]int{"popularityTenths": popularity})
	})
	return nil
}

// Activity is a lease, so a crashed room process cannot leave the DB active forever.
func startRoomActivityWatchdog(app core.App) {
	stopped := make(chan struct{})
	app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error { close(stopped); return e.Next() })
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopped:
				return
			case <-ticker.C:
				before := time.Now().UTC().Add(-45 * time.Second).Format("2006-01-02 15:04:05.000Z")
				if _, err := app.DB().NewQuery("UPDATE player_rooms SET active = false, human_count = 0 WHERE active = true AND last_active < {:before}").Bind(dbx.Params{"before": before}).Execute(); err != nil {
					app.Logger().Warn("Não foi possível atualizar a atividade dos quartos", "error", err)
				}
			}
		}
	}()
}

package standalone

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"time"

	"coffe-mania/shared/appearance"
	"coffe-mania/shared/cafe"
	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
)

// Fetch answers one request of the network client: the /api/coffe routes
// the browser would send to PocketBase. Changes to the room go through the
// room simulation (Manager.Operate), as the server routes do through the
// room service, so the room validates them and everyone inside sees them.
// The client is the player's own here; the café rules still validate every
// value (cafe.Operate), while the server's extra request checks are about
// untrusted browsers.
func (e *Engine) Fetch(method, target string, body []byte) (int, []byte) {
	address, err := url.Parse(target)
	if err != nil {
		return failure(400, "Pedido inválido.")
	}
	path := address.Path
	if method == "GET" {
		return e.get(path, address.Query())
	}
	if method != "POST" {
		return failure(405, "Método não permitido.")
	}
	if action, ok := operations[path]; ok {
		return e.operate(action, body)
	}
	switch path {
	case "/api/coffe/session/login":
		return reply(200, e.session())
	case "/api/coffe/session/logout", "/api/realtime":
		return 204, nil
	case "/api/coffe/game-ticket":
		var request struct {
			RoomID string `json:"roomId"`
		}
		if len(body) > 0 && json.Unmarshal(body, &request) != nil {
			return failure(400, "Quarto inválido.")
		}
		if request.RoomID != "" && request.RoomID != e.profile.ID {
			return failure(404, "Quarto não encontrado.")
		}
		if err := cafe.EnsureRoom(e.store, e.profile.ID); err != nil {
			return failure(500, "Quarto indisponível.")
		}
		return reply(200, map[string]any{"ticket": "local", "roomId": e.profile.ID, "canEdit": true})
	case "/api/coffe/appearance":
		var request struct {
			Appearance string `json:"appearance"`
		}
		if json.Unmarshal(body, &request) != nil {
			return failure(400, "Visual inválido.")
		}
		value, err := appearance.Validate(request.Appearance)
		if err != nil {
			return failure(400, "Visual inválido.")
		}
		state, err := cafe.SetAppearance(e.store, e.profile.ID, value)
		if err != nil {
			return failure(500, "Não foi possível salvar o visual.")
		}
		if m := e.current(); m != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			m.Appearance(ctx, e.profile.ID, value)
			cancel()
		}
		return reply(200, state)
	case "/api/coffe/daily/claim":
		claim, err := cafe.ClaimDaily(e.store, e.profile.ID, time.Now())
		if errors.Is(err, cafe.ErrDailyClaimed) {
			return failure(409, err.Error())
		}
		if err != nil {
			return failure(500, "Não foi possível coletar o bônus.")
		}
		return reply(200, claim)
	case "/api/coffe/mail/claim":
		var request struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(body, &request) != nil || request.ID == "" {
			return failure(400, "Carta inválida.")
		}
		claim, err := cafe.ClaimLetter(e.store, e.profile.ID, request.ID, time.Now())
		switch {
		case errors.Is(err, cafe.ErrMailMissing):
			return failure(404, err.Error())
		case errors.Is(err, cafe.ErrMailClaimed):
			return failure(409, err.Error())
		case err != nil:
			return failure(500, "Não foi possível abrir a carta.")
		}
		return reply(200, claim)
	case "/api/coffe/progress/claim":
		var request struct {
			Kind string `json:"kind"`
			ID   string `json:"id"`
		}
		if json.Unmarshal(body, &request) != nil || request.ID == "" {
			return failure(400, "Prêmio inválido.")
		}
		var claim cafe.ProgressClaim
		var err error
		switch request.Kind {
		case "achievement":
			claim, err = cafe.ClaimAchievement(e.store, e.profile.ID, request.ID, time.Now())
		case "mission":
			claim, err = cafe.ClaimMission(e.store, e.profile.ID, request.ID, time.Now())
		default:
			err = cafe.ErrRewardMissing
		}
		switch {
		case errors.Is(err, cafe.ErrRewardMissing):
			return failure(404, err.Error())
		case errors.Is(err, cafe.ErrRewardClaimed), errors.Is(err, cafe.ErrRewardLocked):
			return failure(409, err.Error())
		case err != nil:
			return failure(500, "Não foi possível resgatar o prêmio.")
		}
		return reply(200, claim)
	case "/api/coffe/cafe/name":
		var request struct {
			Name string `json:"name"`
		}
		if json.Unmarshal(body, &request) != nil {
			return failure(400, "Nome inválido.")
		}
		state, err := cafe.RenameCafe(e.store, e.profile.ID, request.Name)
		if errors.Is(err, cafe.ErrCafeName) {
			return failure(400, err.Error())
		}
		if err != nil {
			return failure(500, "Não foi possível renomear o café.")
		}
		return reply(200, state)
	case "/api/coffe/room/away/ack":
		if err := cafe.AcknowledgeAway(e.store, e.profile.ID); err != nil && !errors.Is(err, cafe.ErrNotFound) {
			return failure(500, "Não foi possível salvar.")
		}
		return reply(200, map[string]bool{"ok": true})
	}
	return failure(404, "Recurso indisponível no modo offline.")
}

func (e *Engine) get(path string, query url.Values) (int, []byte) {
	// A local café has one room: the player's.
	if room := query.Get("room"); room != "" && room != e.profile.ID {
		return failure(404, "Quarto não encontrado.")
	}
	owner := e.profile.ID
	switch path {
	case "/api/coffe/session":
		return reply(200, e.session())
	case "/api/coffe/rules":
		return reply(200, gamerules.Public())
	case "/api/coffe/player-state":
		state, err := cafe.GetOrCreatePlayer(e.store, owner)
		if err != nil {
			return failure(500, "Não foi possível carregar os dados do jogador.")
		}
		return reply(200, cafe.PlayerView(state))
	case "/api/coffe/npc-appearance":
		policy, err := e.store.NPCPolicy()
		if err != nil {
			return failure(500, "Não foi possível carregar o catálogo dos NPCs.")
		}
		return reply(200, policy)
	case "/api/coffe/room":
		if err := cafe.EnsureRoom(e.store, owner); err != nil {
			return failure(500, "Não foi possível carregar o quarto.")
		}
		var snapshot cafe.RoomSnapshot
		err := e.store.Transaction(func(tx cafe.Store) (err error) { snapshot, err = cafe.SnapshotRoom(tx, owner); return })
		if err != nil {
			return failure(500, "Não foi possível carregar o inventário.")
		}
		return reply(200, snapshot)
	case "/api/coffe/cooking":
		if err := cafe.EnsureRoom(e.store, owner); err != nil {
			return failure(500, "Não foi possível carregar o quarto.")
		}
		if err := cafe.EnsureStarterStove(e.store, owner); err != nil {
			return failure(500, "Não foi possível carregar os fogões.")
		}
		snapshot, err := cafe.SnapshotCooking(e.store, owner, time.Now())
		if err != nil {
			return failure(500, "Não foi possível carregar o preparo.")
		}
		return reply(200, snapshot)
	case "/api/coffe/daily":
		daily, err := cafe.Daily(e.store, owner, time.Now())
		if err != nil {
			return failure(500, "Não foi possível carregar o bônus diário.")
		}
		return reply(200, daily)
	case "/api/coffe/mail":
		mail, err := cafe.SnapshotMail(e.store, owner)
		if err != nil {
			return failure(500, "Não foi possível carregar o correio.")
		}
		return reply(200, mail)
	case "/api/coffe/progress":
		progress, err := cafe.SnapshotProgress(e.store, owner, time.Now())
		if err != nil {
			return failure(500, "Não foi possível carregar as conquistas.")
		}
		return reply(200, progress)
	case "/api/coffe/staff":
		snapshot, err := cafe.SnapshotStaff(e.store, owner)
		if err != nil {
			return failure(500, "Não foi possível carregar os funcionários.")
		}
		return reply(200, snapshot)
	}
	return failure(404, "Recurso indisponível no modo offline.")
}

func (e *Engine) operate(action string, body []byte) (int, []byte) {
	if len(body) == 0 {
		body = []byte("{}")
	}
	if !json.Valid(body) {
		return failure(400, "Pedido inválido.")
	}
	m := e.current()
	if m == nil {
		return failure(503, "O café está em pausa. Tente novamente.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	result, err := m.Operate(ctx, gamewire.Operation{Owner: e.profile.ID, User: e.profile.ID, Action: action, Body: body})
	if err != nil {
		return failure(503, "O serviço do quarto está indisponível. Tente novamente.")
	}
	return result.Status, result.Body
}

// operations maps each route that changes the room to its room operation.
var operations = func() map[string]string {
	routes := map[string]string{
		"/api/coffe/room/purchase":     "purchase",
		"/api/coffe/room/move":         "move",
		"/api/coffe/room/store":        "store",
		"/api/coffe/room/tables/clean": "table_clean",
		"/api/coffe/room/expand":       "room_expand",
	}
	for _, route := range cafe.CookingActions {
		routes["/api/coffe/cooking/"+route.Path] = route.Action
	}
	for path, action := range cafe.StaffActions {
		routes["/api/coffe/staff/"+path] = action
	}
	for path, action := range cafe.StreetActions {
		routes[path] = action
	}
	return routes
}()

type session struct {
	PlayerID    string `json:"playerId"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	// Tells the client this is the browser's café, not a server account.
	Offline bool `json:"offline"`
}

func (e *Engine) session() session {
	return session{PlayerID: e.profile.ID, DisplayName: e.profile.Name, Offline: true}
}

func reply(status int, value any) (int, []byte) {
	data, err := json.Marshal(value)
	if err != nil {
		return failure(500, "Resposta inválida.")
	}
	return status, data
}

// failure answers as PocketBase does: the client shows message.
func failure(status int, message string) (int, []byte) {
	data, _ := json.Marshal(map[string]any{"status": status, "message": message, "data": map[string]any{}})
	return status, data
}

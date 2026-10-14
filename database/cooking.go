package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"coffe-mania/database/playerstate"
	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/roomcatalog"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const starterStoveItemID = 3070000

// Fallback for jobs whose recipe left the catalogue.
const defaultSpoilWindow = 2 * time.Minute

var errStoveOccupied = errors.New("stove occupied")
var errStoveNotOwned = errors.New("stove not owned")
var errDishNotReady = errors.New("dish not ready")
var errCookingCannotCancel = errors.New("cooking cannot be canceled")
var errUnknownRecipe = errors.New("Receita desconhecida.")
var errRecipeLocked = errors.New("Receita bloqueada para o seu nível.")
var errCookingCoins = errors.New("Moedas insuficientes para esta receita.")
var errStoveDirty = errors.New("Limpe o fogão antes de cozinhar de novo.")
var errDishSpoiled = errors.New("O prato estragou. Limpe o fogão.")
var errNothingToClean = errors.New("Não há nada para limpar neste fogão.")
var errCleaningCoins = errors.New("Moedas insuficientes para limpar o fogão.")
var errNoCounter = errors.New("Nenhum balcão livre para este prato. Coloque ou libere um balcão.")
var errSeasonClosed = errors.New("Só dá para temperar enquanto o prato está no fogo.")
var errAlreadySeasoned = errors.New("Este prato já foi temperado.")

type cookingView struct {
	ID          string `json:"id"`
	RecipeID    string `json:"recipeId"`
	PreparingAt string `json:"preparingAt"`
	StartedAt   string `json:"startedAt"`
	ReadyAt     string `json:"readyAt"`
	SpoilsAt    string `json:"spoilsAt"`
	Status      string `json:"status"`
	// Servings the dish will yield, including the seasoning bonus.
	Servings int  `json:"servings"`
	Seasoned bool `json:"seasoned,omitempty"`
	// Cooked with fresh farm ingredients: every serving pays the bonus.
	Fresh bool `json:"fresh,omitempty"`
}

type stoveView struct {
	ID      string       `json:"id"`
	ItemID  int          `json:"itemId"`
	TX      int          `json:"tx"`
	TY      int          `json:"ty"`
	Cooking *cookingView `json:"cooking"`
}

type cookingSnapshot struct {
	ServerNow string      `json:"serverNow"`
	Stoves    []stoveView `json:"stoves"`
	// Recipe the owner may cook for free right now (emergency help), if any.
	EmergencyRecipeID string `json:"emergencyRecipeId,omitempty"`
}

func ensureStarterStove(app core.App, userID string) error {
	return app.RunInTransaction(func(txApp core.App) error {
		_, err := txApp.FindFirstRecordByFilter("player_stoves", "user={:user} && item_id={:item}", dbx.Params{"user": userID, "item": starterStoveItemID})
		if err == nil {
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		collection, err := txApp.FindCollectionByNameOrId("player_stoves")
		if err != nil {
			return err
		}
		stove := core.NewRecord(collection)
		stove.Load(map[string]any{"user": userID, "item_id": starterStoveItemID, "tx": 6, "ty": 2})
		return txApp.Save(stove)
	})
}

// jobState derives the phase from absolute times, so progress made while
// nobody was in the café is already accounted for when it is read.
func jobState(job *core.Record, now types.DateTime) (string, types.DateTime) {
	ready := job.GetDateTime("ready_at")
	spoils := job.GetDateTime("spoils_at")
	if spoils.IsZero() {
		window := defaultSpoilWindow
		if recipe, ok := gamerules.RecipeByID(job.GetString("recipe_id")); ok {
			window = recipe.SpoilDuration()
		}
		spoils = ready.Add(window)
	}
	switch {
	case !now.Before(spoils):
		return "spoiled", spoils
	case !now.Before(ready):
		return "ready", spoils
	case !now.Before(job.GetDateTime("started_at")):
		return "cooking", spoils
	default:
		return "preparing", spoils
	}
}

func jobServings(job *core.Record) int {
	servings := 1
	if recipe, ok := gamerules.RecipeByID(job.GetString("recipe_id")); ok {
		servings = recipe.Servings
	}
	return servings + job.GetInt("bonus_servings")
}

// emergencyRecipe reports the free batch: only when the owner cannot afford
// the cheapest recipe and has nothing cooking, ready or on a counter.
func emergencyRecipe(app core.App, userID string, now types.DateTime) (gamerules.Recipe, bool, error) {
	state, err := app.FindFirstRecordByData(playerstate.Collection, "user", userID)
	if err != nil {
		return gamerules.Recipe{}, false, err
	}
	recipe, ok := gamerules.CheapestRecipe(state.GetInt("level"))
	if !ok || state.GetInt64("gold") >= recipe.CostCoins {
		return recipe, false, nil
	}
	jobs, err := app.FindRecordsByFilter("stove_cooking", "user={:user}", "", 0, 0, dbx.Params{"user": userID})
	if err != nil {
		return recipe, false, err
	}
	for _, job := range jobs {
		if status, _ := jobState(job, now); status != "spoiled" {
			return recipe, false, nil
		}
	}
	foods, err := app.FindRecordsByFilter("room_food", "user={:user}", "", 1, 0, dbx.Params{"user": userID})
	if err != nil {
		return recipe, false, err
	}
	return recipe, len(foods) == 0, nil
}

func snapshotCooking(app core.App, userID string, now types.DateTime) (cookingSnapshot, error) {
	result := cookingSnapshot{ServerNow: now.String(), Stoves: []stoveView{}}
	stoves, err := app.FindRecordsByFilter("player_stoves", "user={:user}", "created", 100, 0, dbx.Params{"user": userID})
	if err != nil {
		return result, err
	}
	for _, stove := range stoves {
		unit, inventoryErr := app.FindFirstRecordByData("player_inventory", "stove_id", stove.Id)
		if inventoryErr == nil && !unit.GetBool("placed") {
			continue
		}
		if inventoryErr != nil && !errors.Is(inventoryErr, sql.ErrNoRows) {
			return result, inventoryErr
		}
		view := stoveView{ID: stove.Id, ItemID: stove.GetInt("item_id"), TX: stove.GetInt("tx"), TY: stove.GetInt("ty")}
		job, err := app.FindFirstRecordByData("stove_cooking", "stove", stove.Id)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return result, err
		}
		if err == nil {
			status, spoils := jobState(job, now)
			preparingAt := job.GetDateTime("preparing_at")
			if preparingAt.IsZero() {
				preparingAt = job.GetDateTime("started_at")
			}
			view.Cooking = &cookingView{
				ID: job.Id, RecipeID: job.GetString("recipe_id"),
				PreparingAt: preparingAt.String(),
				StartedAt:   job.GetDateTime("started_at").String(),
				ReadyAt:     job.GetDateTime("ready_at").String(),
				SpoilsAt:    spoils.String(), Status: status,
				Servings: jobServings(job), Seasoned: job.GetString("seasoned_by") != "", Fresh: job.GetBool("fresh"),
			}
		}
		result.Stoves = append(result.Stoves, view)
	}
	if recipe, free, err := emergencyRecipe(app, userID, now); err != nil {
		return result, err
	} else if free {
		result.EmergencyRecipeID = recipe.ID
	}
	return result, nil
}

// ownedStove returns the stove if it belongs to the owner and is placed (or was never stored).
func ownedStove(app core.App, owner, stoveID string) (*core.Record, error) {
	stove, err := app.FindRecordById("player_stoves", stoveID)
	if err != nil || stove.GetString("user") != owner {
		return nil, errStoveNotOwned
	}
	unit, err := app.FindFirstRecordByData("player_inventory", "stove_id", stove.Id)
	if err == nil && !unit.GetBool("placed") {
		return nil, errStoveNotOwned
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	return stove, nil
}

// stoveJob returns the stove's job, or `missing` when it has none.
func stoveJob(app core.App, stoveID string, missing error) (*core.Record, error) {
	job, err := app.FindFirstRecordByData("stove_cooking", "stove", stoveID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, missing
	}
	return job, err
}

// startCooking debits the recipe cost only after ownership and occupancy checks,
// in the same transaction that creates the job.
func startCooking(app core.App, userID, stoveID, recipeID string, now types.DateTime) error {
	recipe, ok := gamerules.RecipeByID(recipeID)
	if !ok {
		return errUnknownRecipe
	}
	return app.RunInTransaction(func(txApp core.App) error {
		stove, err := ownedStove(txApp, userID, stoveID)
		if err != nil {
			return err
		}
		if stove.GetInt("item_id") != starterStoveItemID {
			return errStoveNotOwned
		}
		if job, err := txApp.FindFirstRecordByData("stove_cooking", "stove", stoveID); err == nil {
			if status, _ := jobState(job, now); status == "spoiled" {
				return errStoveDirty
			}
			return errStoveOccupied
		} else if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		state, err := txApp.FindFirstRecordByData(playerstate.Collection, "user", userID)
		if err != nil {
			return err
		}
		if state.GetInt("level") < recipe.Level {
			return errRecipeLocked
		}
		cost := recipe.CostCoins
		free, emergency, err := emergencyRecipe(txApp, userID, now)
		if err != nil {
			return err
		}
		if emergency && free.ID == recipe.ID {
			cost = 0
		}
		if state.GetInt64("gold") < cost {
			return errCookingCoins
		}
		if cost > 0 {
			state.Set("gold", state.GetInt64("gold")-cost)
			if err = txApp.Save(state); err != nil {
				return err
			}
		}
		collection, err := txApp.FindCollectionByNameOrId("stove_cooking")
		if err != nil {
			return err
		}
		started := now.Add(gamerules.PrepareDuration())
		ready := started.Add(recipe.CookDuration())
		job := core.NewRecord(collection)
		job.Load(map[string]any{
			"user": userID, "stove": stoveID, "recipe_id": recipe.ID,
			"preparing_at": now, "started_at": started, "ready_at": ready,
			"spoils_at": ready.Add(recipe.SpoilDuration()),
		})
		// Fresh farm ingredients go into the next batch, whatever the recipe.
		if room, err := txApp.FindFirstRecordByData("player_rooms", "user", userID); err == nil && room.GetInt("fresh_charges") > 0 {
			room.Set("fresh_charges", room.GetInt("fresh_charges")-1)
			if err := txApp.Save(room); err != nil {
				return err
			}
			job.Set("fresh", true)
		} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		return txApp.Save(job)
	})
}

// pickCounter prefers a counter already holding the same recipe, then an empty one.
func pickCounter(app core.App, owner, recipeID string) (string, *core.Record, error) {
	units, err := app.FindRecordsByFilter("player_inventory", "user={:user} && placed=true && layer='object'", "", 0, 0, dbx.Params{"user": owner})
	if err != nil {
		return "", nil, err
	}
	counters := []string{}
	for _, unit := range units {
		if item, ok := roomcatalog.ByID(unit.GetInt("item_id")); ok && item.Kind == "counter" {
			counters = append(counters, unit.Id)
		}
	}
	sort.Strings(counters)
	foods, err := app.FindRecordsByFilter("room_food", "user={:owner}", "", 0, 0, dbx.Params{"owner": owner})
	if err != nil {
		return "", nil, err
	}
	onCounter := map[string]*core.Record{}
	for _, food := range foods {
		if counter := food.GetString("counter"); counter != "" {
			onCounter[counter] = food
		}
	}
	for _, counter := range counters {
		if food := onCounter[counter]; food != nil && food.GetString("recipe_id") == recipeID {
			return counter, food, nil
		}
	}
	for _, counter := range counters {
		if onCounter[counter] == nil {
			return counter, nil, nil
		}
	}
	return "", nil, errNoCounter
}

// serveCooking moves a ready dish from the stove to a counter.
func serveCooking(app core.App, userID, stoveID string, now types.DateTime) error {
	return app.RunInTransaction(func(txApp core.App) error {
		if _, err := ownedStove(txApp, userID, stoveID); err != nil {
			return err
		}
		job, err := stoveJob(txApp, stoveID, errDishNotReady)
		if err != nil {
			return err
		}
		switch status, _ := jobState(job, now); status {
		case "spoiled":
			return errDishSpoiled
		case "preparing", "cooking":
			return errDishNotReady
		}
		recipeID := job.GetString("recipe_id")
		counter, food, err := pickCounter(txApp, userID, recipeID)
		if err != nil {
			return err
		}
		fresh := 0
		if job.GetBool("fresh") {
			fresh = jobServings(job)
		}
		if food != nil {
			food.Set("servings", max(1, food.GetInt("servings"))+jobServings(job))
			food.Set("fresh_servings", food.GetInt("fresh_servings")+fresh)
		} else {
			foods, err := txApp.FindCollectionByNameOrId("room_food")
			if err != nil {
				return err
			}
			food = core.NewRecord(foods)
			food.Load(map[string]any{"user": userID, "recipe_id": recipeID, "job_id": job.Id, "servings": jobServings(job), "counter": counter, "fresh_servings": fresh})
		}
		if err = txApp.Save(food); err != nil {
			return err
		}
		return txApp.Delete(job)
	})
}

func cancelCooking(app core.App, userID, stoveID string, now types.DateTime) error {
	return app.RunInTransaction(func(txApp core.App) error {
		if _, err := ownedStove(txApp, userID, stoveID); err != nil {
			return err
		}
		job, err := stoveJob(txApp, stoveID, errCookingCannotCancel)
		if err != nil {
			return err
		}
		if !now.Before(job.GetDateTime("ready_at")) {
			return errCookingCannotCancel
		}
		// A canceled fresh batch gives the ingredients back, up to the farm's limit.
		if job.GetBool("fresh") {
			room, err := txApp.FindFirstRecordByData("player_rooms", "user", userID)
			if err != nil {
				return err
			}
			room.Set("fresh_charges", min(room.GetInt("fresh_charges")+1, gamerules.Street().Farm.MaxCharges))
			if err := txApp.Save(room); err != nil {
				return err
			}
		}
		return txApp.Delete(job)
	})
}

// cleanStove throws a spoiled dish away; the stove can cook again.
func cleanStove(app core.App, userID, stoveID string, now types.DateTime) error {
	return app.RunInTransaction(func(txApp core.App) error {
		if _, err := ownedStove(txApp, userID, stoveID); err != nil {
			return err
		}
		job, err := stoveJob(txApp, stoveID, errNothingToClean)
		if err != nil {
			return err
		}
		if status, _ := jobState(job, now); status != "spoiled" {
			return errNothingToClean
		}
		state, err := txApp.FindFirstRecordByData(playerstate.Collection, "user", userID)
		if err != nil {
			return err
		}
		rules := gamerules.Stove()
		if state.GetInt64("gold") < rules.CleaningCoins {
			return errCleaningCoins
		}
		playerstate.Grant(state, -rules.CleaningCoins, rules.CleaningXP)
		if err = txApp.Save(state); err != nil {
			return err
		}
		return txApp.Delete(job)
	})
}

// seasonCooking adds the bonus servings once per batch. Visitors may season a
// friend's stove; the seasoner earns the XP.
func seasonCooking(app core.App, owner, seasoner, stoveID string, now types.DateTime) error {
	return app.RunInTransaction(func(txApp core.App) error {
		if _, err := ownedStove(txApp, owner, stoveID); err != nil {
			return err
		}
		job, err := stoveJob(txApp, stoveID, errSeasonClosed)
		if err != nil {
			return err
		}
		if status, _ := jobState(job, now); status != "preparing" && status != "cooking" {
			return errSeasonClosed
		}
		if job.GetString("seasoned_by") != "" {
			return errAlreadySeasoned
		}
		base := 1
		if recipe, ok := gamerules.RecipeByID(job.GetString("recipe_id")); ok {
			base = recipe.Servings
		}
		job.Set("bonus_servings", gamerules.SeasonBonus(base))
		job.Set("seasoned_by", seasoner)
		if err = txApp.Save(job); err != nil {
			return err
		}
		state, err := playerstate.GetOrCreate(txApp, seasoner)
		if err != nil {
			return err
		}
		playerstate.Grant(state, 0, gamerules.Stove().SeasonXP)
		return txApp.Save(state)
	})
}

// cookingActions maps each REST path to its room operation. Only seasoning
// accepts a friend's room; everything else acts on the player's own café.
var cookingActions = []struct {
	path, action string
	visitors     bool
}{
	{"start", "cook_start", false},
	{"serve", "cook_serve", false},
	{"cancel", "cook_cancel", false},
	{"clean", "cook_clean", false},
	{"season", "cook_season", true},
}

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
	for _, route := range cookingActions {
		route := route
		g.POST("/"+route.path, func(r *core.RequestEvent) error {
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
			if route.action == "cook_start" && !knownRecipe || route.action != "cook_start" && body.RecipeID != "" {
				return r.BadRequestError("Fogão ou receita inválidos.", nil)
			}
			owner := user.Id
			if body.RoomID != "" && body.RoomID != user.Id {
				if !route.visitors {
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
				return proxyRoomOperationAs(r, owner, user.Id, route.action, command)
			}
			data, _ := json.Marshal(command)
			result := persistenceOperation(r.App, gamewire.Operation{Owner: owner, User: user.Id, Action: route.action, Body: data})
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

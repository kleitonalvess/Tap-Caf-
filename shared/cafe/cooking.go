package cafe

import (
	"errors"
	"sort"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/roomcatalog"
)

const starterStoveItemID = 3070000

// Fallback for jobs whose recipe left the catalogue.
const defaultSpoilWindow = 2 * time.Minute

var ErrStoveOccupied = errors.New("stove occupied")
var ErrStoveNotOwned = errors.New("stove not owned")
var ErrDishNotReady = errors.New("dish not ready")
var ErrCookingCannotCancel = errors.New("cooking cannot be canceled")
var ErrUnknownRecipe = errors.New("Receita desconhecida.")
var ErrRecipeLocked = errors.New("Receita bloqueada para o seu nível.")
var ErrCookingCoins = errors.New("Moedas insuficientes para esta receita.")
var ErrStoveDirty = errors.New("Limpe o fogão antes de cozinhar de novo.")
var ErrDishSpoiled = errors.New("O prato estragou. Limpe o fogão.")
var ErrNothingToClean = errors.New("Não há nada para limpar neste fogão.")
var ErrCleaningCoins = errors.New("Moedas insuficientes para limpar o fogão.")
var ErrNoCounter = errors.New("Nenhum balcão livre para este prato. Coloque ou libere um balcão.")
var ErrSeasonClosed = errors.New("Só dá para temperar enquanto o prato está no fogo.")
var ErrAlreadySeasoned = errors.New("Este prato já foi temperado.")

type CookingView struct {
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

type StoveView struct {
	ID      string       `json:"id"`
	ItemID  int          `json:"itemId"`
	TX      int          `json:"tx"`
	TY      int          `json:"ty"`
	Cooking *CookingView `json:"cooking"`
}

type CookingSnapshot struct {
	ServerNow string      `json:"serverNow"`
	Stoves    []StoveView `json:"stoves"`
	// Recipe the owner may cook for free right now (emergency help), if any.
	EmergencyRecipeID string `json:"emergencyRecipeId,omitempty"`
}

func EnsureStarterStove(s Store, userID string) error {
	return s.Transaction(func(tx Store) error {
		_, err := tx.First("player_stoves", Where{"user": userID, "item_id": starterStoveItemID})
		if err == nil {
			return nil
		}
		if !errors.Is(err, ErrNotFound) {
			return err
		}
		stove, err := tx.New("player_stoves")
		if err != nil {
			return err
		}
		setAll(stove, map[string]any{"user": userID, "item_id": starterStoveItemID, "tx": 6, "ty": 2})
		return tx.Save(stove)
	})
}

// JobState derives the phase from absolute times, so progress made while
// nobody was in the café is already accounted for when it is read.
func JobState(job Record, now time.Time) (string, time.Time) {
	ready := job.GetTime("ready_at")
	spoils := job.GetTime("spoils_at")
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
	case !now.Before(job.GetTime("started_at")):
		return "cooking", spoils
	default:
		return "preparing", spoils
	}
}

func jobServings(job Record) int {
	servings := 1
	if recipe, ok := gamerules.RecipeByID(job.GetString("recipe_id")); ok {
		servings = recipe.Servings
	}
	return servings + job.GetInt("bonus_servings")
}

// emergencyRecipe reports the free batch: only when the owner cannot afford
// the cheapest recipe and has nothing cooking, ready or on a counter.
func emergencyRecipe(s Store, userID string, now time.Time) (gamerules.Recipe, bool, error) {
	state, err := s.First(PlayerCollection, Where{"user": userID})
	if err != nil {
		return gamerules.Recipe{}, false, err
	}
	recipe, ok := gamerules.CheapestRecipe(state.GetInt("level"))
	if !ok || state.GetInt64("gold") >= recipe.CostCoins {
		return recipe, false, nil
	}
	jobs, err := s.Find("stove_cooking", Query{Where: Where{"user": userID}})
	if err != nil {
		return recipe, false, err
	}
	for _, job := range jobs {
		if status, _ := JobState(job, now); status != "spoiled" {
			return recipe, false, nil
		}
	}
	foods, err := s.Find("room_food", Query{Where: Where{"user": userID}, Limit: 1})
	if err != nil {
		return recipe, false, err
	}
	return recipe, len(foods) == 0, nil
}

// SnapshotCooking lists the placed stoves with their batches as of now.
func SnapshotCooking(s Store, userID string, now time.Time) (CookingSnapshot, error) {
	result := CookingSnapshot{ServerNow: FormatTime(now), Stoves: []StoveView{}}
	stoves, err := s.Find("player_stoves", Query{Where: Where{"user": userID}, Sort: []string{"created"}, Limit: 100})
	if err != nil {
		return result, err
	}
	for _, stove := range stoves {
		unit, inventoryErr := s.First("player_inventory", Where{"stove_id": stove.ID()})
		if inventoryErr == nil && !unit.GetBool("placed") {
			continue
		}
		if inventoryErr != nil && !errors.Is(inventoryErr, ErrNotFound) {
			return result, inventoryErr
		}
		view := StoveView{ID: stove.ID(), ItemID: stove.GetInt("item_id"), TX: stove.GetInt("tx"), TY: stove.GetInt("ty")}
		job, err := s.First("stove_cooking", Where{"stove": stove.ID()})
		if err != nil && !errors.Is(err, ErrNotFound) {
			return result, err
		}
		if err == nil {
			status, spoils := JobState(job, now)
			preparingAt := job.GetTime("preparing_at")
			if preparingAt.IsZero() {
				preparingAt = job.GetTime("started_at")
			}
			view.Cooking = &CookingView{
				ID: job.ID(), RecipeID: job.GetString("recipe_id"),
				PreparingAt: FormatTime(preparingAt),
				StartedAt:   FormatTime(job.GetTime("started_at")),
				ReadyAt:     FormatTime(job.GetTime("ready_at")),
				SpoilsAt:    FormatTime(spoils), Status: status,
				Servings: jobServings(job), Seasoned: job.GetString("seasoned_by") != "", Fresh: job.GetBool("fresh"),
			}
		}
		result.Stoves = append(result.Stoves, view)
	}
	if recipe, free, err := emergencyRecipe(s, userID, now); err != nil {
		return result, err
	} else if free {
		result.EmergencyRecipeID = recipe.ID
	}
	return result, nil
}

// ownedStove returns the stove if it belongs to the owner and is placed (or was never stored).
func ownedStove(s Store, owner, stoveID string) (Record, error) {
	stove, err := s.Get("player_stoves", stoveID)
	if err != nil || stove.GetString("user") != owner {
		return nil, ErrStoveNotOwned
	}
	unit, err := s.First("player_inventory", Where{"stove_id": stove.ID()})
	if err == nil && !unit.GetBool("placed") {
		return nil, ErrStoveNotOwned
	}
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	return stove, nil
}

// stoveJob returns the stove's job, or `missing` when it has none.
func stoveJob(s Store, stoveID string, missing error) (Record, error) {
	job, err := s.First("stove_cooking", Where{"stove": stoveID})
	if errors.Is(err, ErrNotFound) {
		return nil, missing
	}
	return job, err
}

// StartCooking debits the recipe cost only after ownership and occupancy checks,
// in the same transaction that creates the job.
func StartCooking(s Store, userID, stoveID, recipeID string, now time.Time) error {
	recipe, ok := gamerules.RecipeByID(recipeID)
	if !ok {
		return ErrUnknownRecipe
	}
	return s.Transaction(func(tx Store) error {
		stove, err := ownedStove(tx, userID, stoveID)
		if err != nil {
			return err
		}
		if stove.GetInt("item_id") != starterStoveItemID {
			return ErrStoveNotOwned
		}
		if job, err := tx.First("stove_cooking", Where{"stove": stoveID}); err == nil {
			if status, _ := JobState(job, now); status == "spoiled" {
				return ErrStoveDirty
			}
			return ErrStoveOccupied
		} else if !errors.Is(err, ErrNotFound) {
			return err
		}
		state, err := tx.First(PlayerCollection, Where{"user": userID})
		if err != nil {
			return err
		}
		if state.GetInt("level") < recipe.Level {
			return ErrRecipeLocked
		}
		cost := recipe.CostCoins
		free, emergency, err := emergencyRecipe(tx, userID, now)
		if err != nil {
			return err
		}
		if emergency && free.ID == recipe.ID {
			cost = 0
		}
		if state.GetInt64("gold") < cost {
			return ErrCookingCoins
		}
		if cost > 0 {
			state.Set("gold", state.GetInt64("gold")-cost)
			if err = tx.Save(state); err != nil {
				return err
			}
		}
		started := now.Add(gamerules.PrepareDuration())
		ready := started.Add(recipe.CookDuration())
		job, err := tx.New("stove_cooking")
		if err != nil {
			return err
		}
		setAll(job, map[string]any{
			"user": userID, "stove": stoveID, "recipe_id": recipe.ID,
			"preparing_at": now, "started_at": started, "ready_at": ready,
			"spoils_at": ready.Add(recipe.SpoilDuration()),
		})
		// Fresh farm ingredients go into the next batch, whatever the recipe.
		if room, err := tx.First("player_rooms", Where{"user": userID}); err == nil && room.GetInt("fresh_charges") > 0 {
			room.Set("fresh_charges", room.GetInt("fresh_charges")-1)
			if err := tx.Save(room); err != nil {
				return err
			}
			job.Set("fresh", true)
		} else if err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
		return tx.Save(job)
	})
}

// pickCounter prefers a counter already holding the same recipe, then an empty one.
func pickCounter(s Store, owner, recipeID string) (string, Record, error) {
	units, err := s.Find("player_inventory", Query{Where: Where{"user": owner, "placed": true, "layer": "object"}})
	if err != nil {
		return "", nil, err
	}
	counters := []string{}
	for _, unit := range units {
		if item, ok := roomcatalog.ByID(unit.GetInt("item_id")); ok && item.Kind == "counter" {
			counters = append(counters, unit.ID())
		}
	}
	sort.Strings(counters)
	foods, err := s.Find("room_food", Query{Where: Where{"user": owner}})
	if err != nil {
		return "", nil, err
	}
	onCounter := map[string]Record{}
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
	return "", nil, ErrNoCounter
}

// ServeCooking moves a ready dish from the stove to a counter.
func ServeCooking(s Store, userID, stoveID string, now time.Time) error {
	return s.Transaction(func(tx Store) error {
		if _, err := ownedStove(tx, userID, stoveID); err != nil {
			return err
		}
		job, err := stoveJob(tx, stoveID, ErrDishNotReady)
		if err != nil {
			return err
		}
		switch status, _ := JobState(job, now); status {
		case "spoiled":
			return ErrDishSpoiled
		case "preparing", "cooking":
			return ErrDishNotReady
		}
		recipeID := job.GetString("recipe_id")
		counter, food, err := pickCounter(tx, userID, recipeID)
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
			if food, err = tx.New("room_food"); err != nil {
				return err
			}
			setAll(food, map[string]any{"user": userID, "recipe_id": recipeID, "job_id": job.ID(), "servings": jobServings(job), "counter": counter, "fresh_servings": fresh})
		}
		if err = tx.Save(food); err != nil {
			return err
		}
		return tx.Delete(job)
	})
}

func CancelCooking(s Store, userID, stoveID string, now time.Time) error {
	return s.Transaction(func(tx Store) error {
		if _, err := ownedStove(tx, userID, stoveID); err != nil {
			return err
		}
		job, err := stoveJob(tx, stoveID, ErrCookingCannotCancel)
		if err != nil {
			return err
		}
		if !now.Before(job.GetTime("ready_at")) {
			return ErrCookingCannotCancel
		}
		// A canceled fresh batch gives the ingredients back, up to the farm's limit.
		if job.GetBool("fresh") {
			room, err := tx.First("player_rooms", Where{"user": userID})
			if err != nil {
				return err
			}
			room.Set("fresh_charges", min(room.GetInt("fresh_charges")+1, gamerules.Street().Farm.MaxCharges))
			if err := tx.Save(room); err != nil {
				return err
			}
		}
		return tx.Delete(job)
	})
}

// CleanStove throws a spoiled dish away; the stove can cook again.
func CleanStove(s Store, userID, stoveID string, now time.Time) error {
	return s.Transaction(func(tx Store) error {
		if _, err := ownedStove(tx, userID, stoveID); err != nil {
			return err
		}
		job, err := stoveJob(tx, stoveID, ErrNothingToClean)
		if err != nil {
			return err
		}
		if status, _ := JobState(job, now); status != "spoiled" {
			return ErrNothingToClean
		}
		state, err := tx.First(PlayerCollection, Where{"user": userID})
		if err != nil {
			return err
		}
		rules := gamerules.Stove()
		if state.GetInt64("gold") < rules.CleaningCoins {
			return ErrCleaningCoins
		}
		Grant(state, -rules.CleaningCoins, rules.CleaningXP)
		if err = tx.Save(state); err != nil {
			return err
		}
		return tx.Delete(job)
	})
}

// SeasonCooking adds the bonus servings once per batch. Visitors may season a
// friend's stove; the seasoner earns the XP.
func SeasonCooking(s Store, owner, seasoner, stoveID string, now time.Time) error {
	return s.Transaction(func(tx Store) error {
		if _, err := ownedStove(tx, owner, stoveID); err != nil {
			return err
		}
		job, err := stoveJob(tx, stoveID, ErrSeasonClosed)
		if err != nil {
			return err
		}
		if status, _ := JobState(job, now); status != "preparing" && status != "cooking" {
			return ErrSeasonClosed
		}
		if job.GetString("seasoned_by") != "" {
			return ErrAlreadySeasoned
		}
		base := 1
		if recipe, ok := gamerules.RecipeByID(job.GetString("recipe_id")); ok {
			base = recipe.Servings
		}
		job.Set("bonus_servings", gamerules.SeasonBonus(base))
		job.Set("seasoned_by", seasoner)
		if err = tx.Save(job); err != nil {
			return err
		}
		state, err := GetOrCreatePlayer(tx, seasoner)
		if err != nil {
			return err
		}
		Grant(state, 0, gamerules.Stove().SeasonXP)
		return tx.Save(state)
	})
}

// CookingActions maps each REST path to its room operation. Only seasoning
// accepts a friend's room; everything else acts on the player's own café.
var CookingActions = []struct {
	Path, Action string
	Visitors     bool
}{
	{"start", "cook_start", false},
	{"serve", "cook_serve", false},
	{"cancel", "cook_cancel", false},
	{"clean", "cook_clean", false},
	{"season", "cook_season", true},
}

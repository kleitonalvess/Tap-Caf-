package gameruntime

import (
	"encoding/json"
	"strings"
	"time"

	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/roomcatalog"
	"github.com/google/uuid"
)

const servingDuration = 2 * time.Second
const emotionDuration = 6010 * time.Millisecond // NpcEmotion's animation, hold and fade.

type cookingJob struct {
	ID          string `json:"id"`
	PreparingAt string `json:"preparingAt"`
	StartedAt   string `json:"startedAt"`
	ReadyAt     string `json:"readyAt"`
	SpoilsAt    string `json:"spoilsAt"`
}

func (r *room) cookingJob(stoveID string) *cookingJob {
	var snapshot struct {
		Stoves []struct {
			ID      string      `json:"id"`
			Cooking *cookingJob `json:"cooking"`
		} `json:"stoves"`
	}
	if json.Unmarshal(r.world.Cooking, &snapshot) != nil {
		return nil
	}
	for _, stove := range snapshot.Stoves {
		if stove.ID == stoveID {
			return stove.Cooking
		}
	}
	return nil
}

// stoveJobs lists the batches on the owner's stoves, from the last world snapshot.
func (r *room) stoveJobs() []*cookingJob {
	var snapshot struct {
		Stoves []struct {
			Cooking *cookingJob `json:"cooking"`
		} `json:"stoves"`
	}
	if json.Unmarshal(r.world.Cooking, &snapshot) != nil {
		return nil
	}
	jobs := []*cookingJob{}
	for _, stove := range snapshot.Stoves {
		if stove.Cooking != nil {
			jobs = append(jobs, stove.Cooking)
		}
	}
	return jobs
}

// cookingInProgress reports a batch still preparing or cooking (not yet ready).
func (r *room) cookingInProgress(now time.Time) bool {
	for _, job := range r.stoveJobs() {
		if now.Before(jobTime(job.ReadyAt)) {
			return true
		}
	}
	return false
}

// kitchenIdle: nothing edible in the café, neither servings on a counter nor
// a batch on a stove that has not spoiled. Jobs saved without spoilsAt never spoil.
func (r *room) kitchenIdle(now time.Time) bool {
	if len(r.world.Foods) > 0 {
		return false
	}
	for _, job := range r.stoveJobs() {
		if spoils := jobTime(job.SpoilsAt); spoils.IsZero() || now.Before(spoils) {
			return false
		}
	}
	return true
}

func jobTime(value string) time.Time {
	parsed, _ := time.Parse(time.RFC3339Nano, strings.Replace(value, " ", "T", 1))
	return parsed
}

func (r *room) adjacentStove(a *entity, id string) (Unit, bool) {
	for _, u := range r.world.Units {
		if u.StoveID == id && u.StoveID != "" {
			return r.adjacentUnit(a, u.ID, "stove")
		}
	}
	return Unit{}, false
}

// adjacentUnit finds a placed unit of the kind beside a standing actor (one
// orthogonal step from any footprint tile).
func (r *room) adjacentUnit(a *entity, id, kind string) (Unit, bool) {
	if a == nil || a.Move != nil || len(a.path) > 0 || a.ChairID != "" || id == "" {
		return Unit{}, false
	}
	for _, u := range r.world.Units {
		item, ok := roomcatalog.ByID(u.ItemID)
		if !ok || !u.Placed || item.Kind != kind || u.ID != id {
			continue
		}
		for _, tile := range footprint(u) {
			if abs(a.X-tile.X)+abs(a.Y-tile.Y) == 1 {
				return u, true
			}
		}
	}
	return Unit{}, false
}

// busyState is an actor action that blocks commands until it is due.
func busyState(state string) bool {
	return state == "cooking" || state == "serving" || state == "cleaning" || state == "picking" || state == "busing"
}

func (r *room) startStoveAction(a *entity, stove Unit, kind string, start time.Time, duration time.Duration) {
	r.startUnitAction(a, stove, kind, start, duration)
}

func (r *room) startUnitAction(a *entity, unit Unit, kind string, start time.Time, duration time.Duration) {
	// All supported action frames are diagonal views. Face the nearest tile of the unit.
	target := Tile{X: unit.X, Y: unit.Y}
	for _, tile := range footprint(unit) {
		if abs(a.X-tile.X)+abs(a.Y-tile.Y) == 1 {
			target = tile
			break
		}
	}
	a.Direction = direction(Tile{X: a.X, Y: a.Y}, target)
	a.State = kind
	a.Action = &gamewire.ActorAction{Kind: kind, StoveID: unit.StoveID, StartedAt: start.UnixMilli(), Duration: duration.Milliseconds()}
	a.due = time.UnixMilli(a.Action.StartedAt + a.Action.Duration)
}

func (r *room) startCookingAction(a *entity, stoveID string, now time.Time) {
	stove, ok := r.adjacentStove(a, stoveID)
	if !ok {
		return
	}
	start, duration := now, servingDuration
	if job := r.cookingJob(stoveID); job != nil {
		preparing, cooking := jobTime(job.PreparingAt), jobTime(job.StartedAt)
		if !preparing.IsZero() && cooking.After(preparing) {
			start, duration = preparing, cooking.Sub(preparing)
		}
	}
	r.startStoveAction(a, stove, "cooking", start, duration)
}

func (r *room) startServingAction(a *entity, stoveID string, now time.Time) string {
	stove, ok := r.adjacentStove(a, stoveID)
	if !ok {
		return "Aproxime seu personagem do fogão."
	}
	job := r.cookingJob(stoveID)
	if job == nil || jobTime(job.ReadyAt).IsZero() || now.Before(jobTime(job.ReadyAt)) {
		return "O prato ainda não está pronto."
	}
	if spoils := jobTime(job.SpoilsAt); !spoils.IsZero() && !now.Before(spoils) {
		return "O prato estragou. Limpe o fogão."
	}
	r.startStoveAction(a, stove, "serving", now, servingDuration)
	return ""
}

func (r *room) startEmotion(a *entity, kind string, now time.Time) {
	if a.EmotionShown {
		return
	}
	a.EmotionShown = true
	a.Emotion = &gamewire.Emotion{ID: uuid.NewString(), Kind: kind, StartedAt: now.UnixMilli(), Duration: emotionDuration.Milliseconds()}
}

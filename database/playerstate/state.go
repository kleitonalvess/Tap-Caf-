// Package playerstate is the PocketBase side of the player's HUD values: the
// rules live in shared/cafe; this package adds the server-only validation.
package playerstate

import (
	"coffe-mania/database/pbstore"
	"coffe-mania/shared/appearance"
	"coffe-mania/shared/cafe"

	validation "github.com/pocketbase/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"
)

const Collection = cafe.PlayerCollection
const DefaultCafeName = cafe.DefaultCafeName
const StarterCash = cafe.StarterCash

type Resource = cafe.Resource
type Snapshot = cafe.PlayerSnapshot
type Progress = cafe.Progress

// NewRecord holds the initial resources of a new player (migrations backfill with it).
func NewRecord(collection *core.Collection, userID string) *core.Record {
	record := core.NewRecord(collection)
	record.Load(cafe.NewPlayerFields(userID))
	return record
}

func View(record *core.Record) Snapshot { return cafe.PlayerView(pbstore.Wrap(record)) }

// GetOrCreate finds the player's state and provisions a new player once.
func GetOrCreate(app core.App, userID string) (*core.Record, error) {
	record, err := cafe.GetOrCreatePlayer(pbstore.New(app), userID)
	return pbstore.Unwrap(record), err
}

// Field validation enforces integers/nonnegative values; these cross-field
// constraints also apply to trusted server code and dashboard edits.
func RegisterValidation(app core.App) {
	app.OnRecordValidate(Collection).BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		problems := validation.Errors{}
		if e.Record.GetFloat("energy_max") <= 0 {
			problems["energy_max"] = validation.NewError("invalid_energy_capacity", "A capacidade de energia deve ser positiva.")
		}
		if value := e.Record.GetString("appearance"); value != "" {
			if _, err := appearance.Validate(value); err != nil {
				problems["appearance"] = validation.NewError("invalid_appearance", "Visual inválido.")
			}
		}
		// Energy can exceed its normal capacity after grants/events. Its field
		// still enforces a nonnegative safe integer; other resources retain their caps.
		for _, pair := range [][2]string{
			{"experience_current", "experience_max"},
			{"crates_current", "crates_max"},
			{"satisfaction_current_tenths", "satisfaction_max_tenths"},
		} {
			if e.Record.GetFloat(pair[0]) > e.Record.GetFloat(pair[1]) {
				problems[pair[0]] = validation.NewError("current_exceeds_maximum", "O valor atual não pode superar o máximo.")
			}
		}
		if len(problems) > 0 {
			return problems
		}
		return nil
	})
}

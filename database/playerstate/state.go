// Package playerstate owns the persisted HUD snapshot. Percentages and emotion
// frames are presentation data and deliberately aren't stored in SQLite.
package playerstate

import (
	"database/sql"
	"errors"

	"coffe-mania/database/appearance"
	"coffe-mania/shared/gamerules"

	validation "github.com/pocketbase/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"
)

const Collection = "player_state"
const DefaultCafeName = "Coffe Mania"

type Resource struct {
	Current float64 `json:"current"`
	Maximum float64 `json:"maximum"`
}

type Snapshot struct {
	Appearance   string   `json:"appearance"`
	CafeName     string   `json:"cafeName"`
	Cash         int64    `json:"cash"`
	Gold         int64    `json:"gold"`
	Level        int      `json:"level"`
	Experience   Resource `json:"experience"`
	Energy       Resource `json:"energy"`
	Crates       Resource `json:"crates"`
	Satisfaction Resource `json:"satisfaction"`
}

// Initial resources for newly provisioned players.
func NewRecord(collection *core.Collection, userID string) *core.Record {
	record := core.NewRecord(collection)
	record.Load(map[string]any{
		"cafe_name": DefaultCafeName,
		"user":      userID, "cash": 1000, "gold": 100, "level": 1,
		"experience_current": 0, "experience_max": gamerules.NextLevelXP(1),
		"energy_current": 50, "energy_max": 50,
		"crates_current": 4, "crates_max": 4,
		"satisfaction_current_tenths": 800, "satisfaction_max_tenths": 1050,
	})
	return record
}

func View(record *core.Record) Snapshot {
	resource := func(current, maximum string, divisor float64) Resource {
		return Resource{record.GetFloat(current) / divisor, record.GetFloat(maximum) / divisor}
	}
	return Snapshot{
		Appearance: record.GetString("appearance"),
		CafeName:   record.GetString("cafe_name"),
		Cash:       record.GetInt64("cash"), Gold: record.GetInt64("gold"), Level: record.GetInt("level"),
		Experience:   resource("experience_current", "experience_max", 1),
		Energy:       resource("energy_current", "energy_max", 1),
		Crates:       resource("crates_current", "crates_max", 1),
		Satisfaction: resource("satisfaction_current_tenths", "satisfaction_max_tenths", 10),
	}
}

// Progress reports one award; the record keeps total XP in experience_current
// and the total required for the next level in experience_max.
type Progress struct {
	Coins            int64
	XP               int64
	Level            int
	LevelUp          bool
	LevelReward      int64
	PopularityTenths int
}

// Grant credits coins and XP and applies level-ups with their coin rewards.
// Levels never decrease, including values set from the dashboard.
func Grant(record *core.Record, coins, xp int64) Progress {
	previous := max(1, record.GetInt("level"))
	total := record.GetInt64("experience_current") + xp
	level := min(gamerules.MaxLevel(), max(previous, gamerules.LevelForXP(total)))
	reward := gamerules.LevelRewards(previous, level)
	record.Set("gold", record.GetInt64("gold")+coins+reward)
	record.Set("level", level)
	record.Set("experience_current", total)
	record.Set("experience_max", max(total, gamerules.NextLevelXP(level)))
	return Progress{Coins: coins, XP: xp, Level: level, LevelUp: level > previous, LevelReward: reward,
		PopularityTenths: record.GetInt("satisfaction_current_tenths")}
}

// Award credits a served customer: Grant plus a satisfied verdict.
func Award(record *core.Record, coins, xp int64) Progress {
	progress := Grant(record, coins, xp)
	progress.PopularityTenths = ApplyVerdict(record, true)
	return progress
}

// ApplyVerdict moves the café popularity (stored as satisfaction tenths) for one customer.
func ApplyVerdict(record *core.Record, satisfied bool) int {
	value := min(record.GetInt("satisfaction_max_tenths"), gamerules.ApplyCustomer(record.GetInt("satisfaction_current_tenths"), satisfied))
	record.Set("satisfaction_current_tenths", value)
	return value
}

// Existing players cost one indexed lookup; new accounts are provisioned once.
// Recheck inside the transaction so simultaneous tabs cannot create duplicates.
func GetOrCreate(app core.App, userID string) (*core.Record, error) {
	record, err := app.FindFirstRecordByData(Collection, "user", userID)
	if err == nil || !errors.Is(err, sql.ErrNoRows) {
		return record, err
	}
	err = app.RunInTransaction(func(txApp core.App) error {
		record, err = txApp.FindFirstRecordByData(Collection, "user", userID)
		if err == nil || !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		collection, err := txApp.FindCollectionByNameOrId(Collection)
		if err != nil {
			return err
		}
		record = NewRecord(collection, userID)
		return txApp.Save(record)
	})
	return record, err
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

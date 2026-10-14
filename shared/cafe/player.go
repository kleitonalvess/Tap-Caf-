package cafe

import (
	"errors"

	"coffe-mania/shared/gamerules"
)

// PlayerCollection keeps the HUD values of each player. Percentages and
// emotion frames are presentation data and deliberately aren't stored.
const PlayerCollection = "player_state"
const DefaultCafeName = "Coffe Mania"

// StarterCash is the Grana of a new account, set by the project owner: enough
// to try one expansion shortcut (10×10 costs 10), not to skip to 20×20.
// Existing accounts keep their balance.
const StarterCash = 25

type Resource struct {
	Current float64 `json:"current"`
	Maximum float64 `json:"maximum"`
}

type PlayerSnapshot struct {
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

// NewPlayerFields are the initial resources of a new player.
func NewPlayerFields(userID string) map[string]any {
	return map[string]any{
		"cafe_name": DefaultCafeName,
		"user":      userID, "cash": StarterCash, "gold": 100, "level": 1,
		"experience_current": 0, "experience_max": gamerules.NextLevelXP(1),
		"energy_current": 50, "energy_max": 50,
		"crates_current": 4, "crates_max": 4,
		"satisfaction_current_tenths": 800, "satisfaction_max_tenths": 1050,
	}
}

func PlayerView(record Record) PlayerSnapshot {
	resource := func(current, maximum string, divisor float64) Resource {
		return Resource{record.GetFloat(current) / divisor, record.GetFloat(maximum) / divisor}
	}
	return PlayerSnapshot{
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
func Grant(record Record, coins, xp int64) Progress {
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
func Award(record Record, coins, xp int64) Progress {
	progress := Grant(record, coins, xp)
	progress.PopularityTenths = ApplyVerdict(record, true)
	return progress
}

// ApplyVerdict moves the café popularity (stored as satisfaction tenths) for one customer.
func ApplyVerdict(record Record, satisfied bool) int {
	value := min(record.GetInt("satisfaction_max_tenths"), gamerules.ApplyCustomer(record.GetInt("satisfaction_current_tenths"), satisfied))
	record.Set("satisfaction_current_tenths", value)
	return value
}

// GetOrCreatePlayer finds the player's state and provisions it once. The
// recheck inside the transaction keeps simultaneous tabs from creating two.
func GetOrCreatePlayer(s Store, userID string) (Record, error) {
	record, err := s.First(PlayerCollection, Where{"user": userID})
	if err == nil || !errors.Is(err, ErrNotFound) {
		return record, err
	}
	err = s.Transaction(func(tx Store) error {
		record, err = tx.First(PlayerCollection, Where{"user": userID})
		if err == nil || !errors.Is(err, ErrNotFound) {
			return err
		}
		if record, err = tx.New(PlayerCollection); err != nil {
			return err
		}
		setAll(record, NewPlayerFields(userID))
		return tx.Save(record)
	})
	return record, err
}

// SetAppearance stores a validated look and returns the new HUD values.
func SetAppearance(s Store, userID, value string) (PlayerSnapshot, error) {
	if _, err := GetOrCreatePlayer(s, userID); err != nil {
		return PlayerSnapshot{}, err
	}
	var state PlayerSnapshot
	// Refetch inside the transaction to preserve concurrent economy/HUD changes.
	err := s.Transaction(func(tx Store) error {
		record, err := tx.First(PlayerCollection, Where{"user": userID})
		if err != nil {
			return err
		}
		record.Set("appearance", value)
		if err := tx.Save(record); err != nil {
			return err
		}
		state = PlayerView(record)
		return nil
	})
	return state, err
}

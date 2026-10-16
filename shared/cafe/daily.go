package cafe

import (
	"errors"
	"time"

	"coffe-mania/shared/gamerules"
)

// The daily bonus counts calendar days in São Paulo. Brazil has had no
// daylight saving time since 2019, so a fixed offset gives the same dates
// without a time zone database (the browser build has none).
var bonusZone = time.FixedZone("America/Sao_Paulo", -3*60*60)

var ErrDailyClaimed = errors.New("O bônus de hoje já foi coletado. Volte amanhã!")

// DailyState is the bonus as the player sees it now.
type DailyState struct {
	// The day of the streak the next claim pays; once claimed, today's day.
	Day       int  `json:"day"`
	Claimable bool `json:"claimable"`
	// Next midnight in São Paulo, when a new day can be claimed (Unix ms).
	NextAt int64                   `json:"nextAt"`
	Days   []gamerules.DailyReward `json:"days"`
}

// DailyClaim is a claim's answer: the new state, what it paid and the HUD.
type DailyClaim struct {
	Daily  DailyState            `json:"daily"`
	Reward gamerules.DailyReward `json:"reward"`
	// Coins for the level-ups the reward caused, if any (rewards carry no XP today).
	LevelReward int64 `json:"levelReward,omitempty"`
	// The random spices the day added to the pantry (codes).
	Spices []int `json:"spices,omitempty"`
	// Free crates the day added (fewer than the reward's when the HUD's limit is reached).
	Crates int            `json:"crates,omitempty"`
	State  PlayerSnapshot `json:"state"`
}

func bonusDate(t time.Time) string { return t.In(bonusZone).Format(time.DateOnly) }

// nextMidnight is the next São Paulo midnight after t, when a new day opens.
func nextMidnight(t time.Time) time.Time {
	local := t.In(bonusZone)
	return time.Date(local.Year(), local.Month(), local.Day()+1, 0, 0, 0, 0, bonusZone)
}

// dailyState reads player_state.daily_claimed_on (the São Paulo date of the
// last claim) and daily_streak (the day it paid). A claim on the next date
// continues the streak, after the last day it starts over, and a gap resets
// it. A last claim dated after today (a clock moved back) blocks the claim.
func dailyState(state Record, now time.Time) DailyState {
	days := gamerules.Daily().Days
	local := now.In(bonusZone)
	today := local.Format(time.DateOnly)
	yesterday := time.Date(local.Year(), local.Month(), local.Day()-1, 12, 0, 0, 0, bonusZone).Format(time.DateOnly)
	result := DailyState{Days: days, NextAt: nextMidnight(now).UnixMilli()}
	last, streak := state.GetString("daily_claimed_on"), state.GetInt("daily_streak")
	switch {
	case last != "" && last >= today:
		result.Day = min(max(streak, 1), len(days))
	case last == yesterday && streak >= 1:
		result.Day = streak%len(days) + 1
		result.Claimable = true
	default:
		result.Day = 1
		result.Claimable = true
	}
	return result
}

// Daily is the player's bonus now.
func Daily(s Store, user string, now time.Time) (DailyState, error) {
	state, err := GetOrCreatePlayer(s, user)
	if err != nil {
		return DailyState{}, err
	}
	return dailyState(state, now), nil
}

// ClaimDaily pays today's bonus once: the date is checked and written in the
// same transaction as the credit, so a second claim that day is refused.
func ClaimDaily(s Store, user string, now time.Time) (DailyClaim, error) {
	if _, err := GetOrCreatePlayer(s, user); err != nil {
		return DailyClaim{}, err
	}
	var claim DailyClaim
	err := s.Transaction(func(tx Store) error {
		state, err := tx.First(PlayerCollection, Where{"user": user})
		if err != nil {
			return err
		}
		current := dailyState(state, now)
		if !current.Claimable {
			return ErrDailyClaimed
		}
		reward := gamerules.DailyRewardFor(current.Day)
		progress := Grant(state, reward.Coins, 0)
		state.Set("cash", state.GetInt64("cash")+reward.Cash)
		state.Set("daily_claimed_on", bonusDate(now))
		state.Set("daily_streak", current.Day)
		spices := randomSpices(state, reward.Spices)
		crates := 0
		for range reward.Crates {
			if grantFreeCrate(state) {
				crates++
			}
		}
		if err := tx.Save(state); err != nil {
			return err
		}
		claim = DailyClaim{Daily: dailyState(state, now), Reward: reward, LevelReward: progress.LevelReward, Spices: spices, Crates: crates, State: PlayerView(state)}
		return nil
	})
	return claim, err
}

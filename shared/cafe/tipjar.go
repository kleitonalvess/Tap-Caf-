package cafe

import (
	"errors"
	"time"

	"coffe-mania/shared/gamerules"
)

var ErrTipJarEmpty = errors.New("O pote de gorjetas está vazio.")

// TipJarView is the café's tip jar: player_rooms.tip_jar coins, up to the
// <tips> limit of the owner's level band.
type TipJarView struct {
	Coins int64 `json:"coins"`
	Cap   int64 `json:"cap"`
}

// TipJarCollect answers a collection: what it paid and the HUD.
type TipJarCollect struct {
	Coins       int64          `json:"coins"`
	LevelReward int64          `json:"levelReward,omitempty"`
	Jar         TipJarView     `json:"jar"`
	State       PlayerSnapshot `json:"state"`
}

// fillTipJar adds a deposit up to the jar's limit and returns what it holds.
// A jar above the limit (the level band shrank, never in play) keeps its coins.
func fillTipJar(room Record, level int, deposit int64) int64 {
	jar := room.GetInt64("tip_jar")
	if limit := gamerules.TipJarCap(level); jar < limit {
		jar = min(limit, jar+deposit)
		room.Set("tip_jar", jar)
	}
	return jar
}

func tipJarView(room Record, level int) TipJarView {
	return TipJarView{Coins: room.GetInt64("tip_jar"), Cap: gamerules.TipJarCap(level)}
}

// CollectTips empties the tip jar into the owner's coins in one transaction;
// the coins count as earned coins and tips for the day's cash summary.
func CollectTips(s Store, owner string, now time.Time) (TipJarCollect, error) {
	var result TipJarCollect
	err := s.Transaction(func(tx Store) error {
		room, err := tx.First("player_rooms", Where{"user": owner})
		if err != nil {
			return err
		}
		coins := room.GetInt64("tip_jar")
		if coins <= 0 {
			return ErrTipJarEmpty
		}
		state, err := tx.First(PlayerCollection, Where{"user": owner})
		if err != nil {
			return err
		}
		progress := Grant(state, coins, 0)
		room.Set("tip_jar", 0)
		if err = tx.Save(room); err != nil {
			return err
		}
		if err = tx.Save(state); err != nil {
			return err
		}
		if err = countStats(tx, owner, now, statChange{stat: gamerules.StatEarnedCoins, delta: coins}, statChange{stat: gamerules.StatTips, delta: coins}); err != nil {
			return err
		}
		result = TipJarCollect{Coins: coins, LevelReward: progress.LevelReward, Jar: tipJarView(room, state.GetInt("level")), State: PlayerView(state)}
		return nil
	})
	return result, err
}

package cafe

import (
	"errors"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
)

var ErrFoodGone = errors.New("Prato indisponível.")

// ServeCustomer takes one serving and credits the owner in one transaction, so a
// customer can never eat without paying or pay for a serving that was not taken.
// A waiter's delivery adds the customer's tip to the coins (Payment.Coins is
// the total, Payment.Tip its share).
func ServeCustomer(s Store, owner, foodID, tableID string, waiter bool, now time.Time) (gamewire.Payment, error) {
	return ServeServing(s, owner, foodID, tableID, waiter, now)
}

// ServeServing credits one serving as of the given instant (the offline
// catch-up replays past meals). Tips: a waiter's delivery always tips; during a
// party the tip is multiplied and self-served customers tip too, as they do
// when the café has a cash register. A fresh serving (farm ingredients) adds
// its bonus to coins and XP.
func ServeServing(s Store, owner, foodID, tableID string, waiter bool, at time.Time) (gamewire.Payment, error) {
	var payment gamewire.Payment
	err := s.Transaction(func(tx Store) error {
		food, err := tx.Get("room_food", foodID)
		if errors.Is(err, ErrNotFound) || err == nil && food.GetString("user") != owner {
			return ErrFoodGone
		}
		if err != nil {
			return err
		}
		// Dishes served before servings existed hold exactly one.
		left := max(1, food.GetInt("servings")) - 1
		fresh := food.GetInt("fresh_servings")
		freshLeft := min(left, max(0, fresh-1))
		if left == 0 {
			err = tx.Delete(food)
		} else {
			food.Set("servings", left)
			food.Set("fresh_servings", freshLeft)
			err = tx.Save(food)
		}
		if err != nil {
			return err
		}
		state, err := tx.First(PlayerCollection, Where{"user": owner})
		if err != nil {
			return err
		}
		// An unknown recipe still feeds the customer; it just pays nothing.
		recipe, _ := gamerules.RecipeByID(food.GetString("recipe_id"))
		party := false
		room, err := tx.First("player_rooms", Where{"user": owner})
		if err == nil {
			party = partyActive(room, at)
		} else if !errors.Is(err, ErrNotFound) {
			return err
		}
		register := false
		if !waiter && !party {
			if register, err = hasPlacedKind(tx, owner, "register"); err != nil {
				return err
			}
		}
		var tip int64
		switch {
		case waiter && party:
			tip = gamerules.WaiterTip(recipe.PricePerServing) * gamerules.Street().Disco.TipMultiplier
		case waiter || party || register:
			tip = gamerules.WaiterTip(recipe.PricePerServing)
		}
		var freshCoins, freshXP int64
		if fresh > 0 {
			freshCoins, freshXP = gamerules.FreshBonus(recipe.PricePerServing), gamerules.FreshBonus(recipe.XPPerServing)
		}
		progress := Award(state, recipe.PricePerServing+tip+freshCoins, recipe.XPPerServing+freshXP)
		if err = tx.Save(state); err != nil {
			return err
		}
		if err = leavePlate(tx, owner, tableID); err != nil {
			return err
		}
		// Every paid serving drops a little into the tip jar, up to its limit.
		var jar int64
		if room != nil {
			jar = fillTipJar(room, state.GetInt("level"), gamerules.TipJarDeposit(recipe.PricePerServing))
			if err = tx.Save(room); err != nil {
				return err
			}
		}
		if err = countStats(tx, owner, at, statChange{stat: gamerules.StatCustomers, delta: 1},
			statChange{stat: gamerules.StatEarnedCoins, delta: progress.Coins}, statChange{stat: gamerules.StatTips, delta: tip}); err != nil {
			return err
		}
		payment = gamewire.Payment{
			RecipeID: food.GetString("recipe_id"), Coins: progress.Coins, Tip: tip, XP: progress.XP,
			FreshCoins: freshCoins, FreshXP: freshXP, FreshLeft: freshLeft,
			Level: progress.Level, LevelUp: progress.LevelUp, LevelReward: progress.LevelReward,
			ServingsLeft: left, PopularityTenths: progress.PopularityTenths, TipJar: jar,
		}
		return nil
	})
	return payment, err
}

// RecordVerdict applies a customer's verdict that did not come with a payment.
func RecordVerdict(s Store, owner string, satisfied bool) (int, error) {
	var popularity int
	err := s.Transaction(func(tx Store) error {
		state, err := tx.First(PlayerCollection, Where{"user": owner})
		if err != nil {
			return err
		}
		popularity = ApplyVerdict(state, satisfied)
		return tx.Save(state)
	})
	return popularity, err
}

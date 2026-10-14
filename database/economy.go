package main

import (
	"database/sql"
	"errors"
	"time"

	"coffe-mania/database/playerstate"
	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
	"github.com/pocketbase/pocketbase/core"
)

var errFoodGone = errors.New("Prato indisponível.")

// serveCustomer takes one serving and credits the owner in one transaction, so a
// customer can never eat without paying or pay for a serving that was not taken.
func serveCustomer(app core.App, owner, foodID, tableID string) (gamewire.Payment, error) {
	return serveCustomerBy(app, owner, foodID, tableID, false)
}

// serveCustomerBy credits one serving; a waiter's delivery adds the customer's
// tip to the coins (Payment.Coins is the total, Payment.Tip its share).
func serveCustomerBy(app core.App, owner, foodID, tableID string, waiter bool) (gamewire.Payment, error) {
	return serveServing(app, owner, foodID, tableID, waiter, time.Now())
}

// serveServing credits one serving as of the given instant (the offline
// catch-up replays past meals). Tips: a waiter's delivery always tips; during a
// party the tip is multiplied and self-served customers tip too. A fresh
// serving (farm ingredients) adds its bonus to coins and XP.
func serveServing(app core.App, owner, foodID, tableID string, waiter bool, at time.Time) (gamewire.Payment, error) {
	var payment gamewire.Payment
	err := app.RunInTransaction(func(tx core.App) error {
		food, err := tx.FindRecordById("room_food", foodID)
		if errors.Is(err, sql.ErrNoRows) || err == nil && food.GetString("user") != owner {
			return errFoodGone
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
		state, err := tx.FindFirstRecordByData(playerstate.Collection, "user", owner)
		if err != nil {
			return err
		}
		// An unknown recipe still feeds the customer; it just pays nothing.
		recipe, _ := gamerules.RecipeByID(food.GetString("recipe_id"))
		party := false
		if room, err := tx.FindFirstRecordByData("player_rooms", "user", owner); err == nil {
			party = partyActive(room, at)
		} else if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		var tip int64
		switch {
		case waiter && party:
			tip = gamerules.WaiterTip(recipe.PricePerServing) * gamerules.Street().Disco.TipMultiplier
		case waiter || party:
			tip = gamerules.WaiterTip(recipe.PricePerServing)
		}
		var freshCoins, freshXP int64
		if fresh > 0 {
			freshCoins, freshXP = gamerules.FreshBonus(recipe.PricePerServing), gamerules.FreshBonus(recipe.XPPerServing)
		}
		progress := playerstate.Award(state, recipe.PricePerServing+tip+freshCoins, recipe.XPPerServing+freshXP)
		if err = tx.Save(state); err != nil {
			return err
		}
		if err = leavePlate(tx, owner, tableID); err != nil {
			return err
		}
		payment = gamewire.Payment{
			RecipeID: food.GetString("recipe_id"), Coins: progress.Coins, Tip: tip, XP: progress.XP,
			FreshCoins: freshCoins, FreshXP: freshXP, FreshLeft: freshLeft,
			Level: progress.Level, LevelUp: progress.LevelUp, LevelReward: progress.LevelReward,
			ServingsLeft: left, PopularityTenths: progress.PopularityTenths,
		}
		return nil
	})
	return payment, err
}

// recordVerdict applies a customer's verdict that did not come with a payment.
func recordVerdict(app core.App, owner string, satisfied bool) (int, error) {
	var popularity int
	err := app.RunInTransaction(func(tx core.App) error {
		state, err := tx.FindFirstRecordByData(playerstate.Collection, "user", owner)
		if err != nil {
			return err
		}
		popularity = playerstate.ApplyVerdict(state, satisfied)
		return tx.Save(state)
	})
	return popularity, err
}

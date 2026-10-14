package main

import (
	"database/sql"
	"errors"

	"coffe-mania/database/playerstate"
	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
	"github.com/pocketbase/pocketbase/core"
)

var errFoodGone = errors.New("Prato indisponível.")

// serveCustomer takes one serving and credits the owner in one transaction, so a
// customer can never eat without paying or pay for a serving that was not taken.
func serveCustomer(app core.App, owner, foodID, tableID string) (gamewire.Payment, error) {
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
		if left == 0 {
			err = tx.Delete(food)
		} else {
			food.Set("servings", left)
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
		progress := playerstate.Award(state, recipe.PricePerServing, recipe.XPPerServing)
		if err = tx.Save(state); err != nil {
			return err
		}
		if err = leavePlate(tx, owner, tableID); err != nil {
			return err
		}
		payment = gamewire.Payment{
			RecipeID: food.GetString("recipe_id"), Coins: progress.Coins, XP: progress.XP,
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

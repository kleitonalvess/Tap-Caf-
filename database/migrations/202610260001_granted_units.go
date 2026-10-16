package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Sprint 15b: inventory units the game gives away (the starter room, the floor
// and walls of an expansion) are marked granted and never sell for coins, so
// selling cannot turn free tiles into money. Older units were never marked:
// their starter furniture keeps the sale value it had.
func init() {
	m.Register(func(app core.App) error {
		units, err := app.FindCollectionByNameOrId("player_inventory")
		if err != nil {
			return err
		}
		units.Fields.Add(&core.BoolField{Name: "granted"})
		return app.Save(units)
	}, func(app core.App) error {
		units, err := app.FindCollectionByNameOrId("player_inventory")
		if err != nil {
			return err
		}
		units.Fields.RemoveByName("granted")
		return app.Save(units)
	})
}

package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Street buildings (Sprint 9): the farm's last harvest and the fresh charges
// it gave, the last party at the disco, and which batches and counter
// servings were made with fresh ingredients. All timers are absolute instants.
func init() {
	m.Register(func(app core.App) error {
		zero := 0.0
		rooms, err := app.FindCollectionByNameOrId("player_rooms")
		if err != nil {
			return err
		}
		rooms.Fields.Add(
			&core.DateField{Name: "farm_harvested_at"},
			&core.NumberField{Name: "fresh_charges", OnlyInt: true, Min: &zero},
			&core.DateField{Name: "party_started_at"},
		)
		if err := app.Save(rooms); err != nil {
			return err
		}
		jobs, err := app.FindCollectionByNameOrId("stove_cooking")
		if err != nil {
			return err
		}
		jobs.Fields.Add(&core.BoolField{Name: "fresh"})
		if err := app.Save(jobs); err != nil {
			return err
		}
		foods, err := app.FindCollectionByNameOrId("room_food")
		if err != nil {
			return err
		}
		foods.Fields.Add(&core.NumberField{Name: "fresh_servings", OnlyInt: true, Min: &zero})
		return app.Save(foods)
	}, func(app core.App) error {
		for collection, fields := range map[string][]string{
			"player_rooms":  {"farm_harvested_at", "fresh_charges", "party_started_at"},
			"stove_cooking": {"fresh"}, "room_food": {"fresh_servings"},
		} {
			c, err := app.FindCollectionByNameOrId(collection)
			if err != nil {
				return err
			}
			for _, name := range fields {
				c.Fields.RemoveByName(name)
			}
			if err := app.Save(c); err != nil {
				return err
			}
		}
		return nil
	})
}

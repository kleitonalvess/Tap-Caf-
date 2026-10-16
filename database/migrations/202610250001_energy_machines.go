package migrations

import (
	"coffe-mania/database/playerstate"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Sprint 15b: energy regenerates from player_state.energy_at (shared/cafe
// energyNow), and each jukebox or arcade has a room_machines row: level, parts
// toward the next level, the instant it was switched on, runs since the last
// repair and whether it is broken.
func init() {
	m.Register(func(app core.App) error {
		state, err := app.FindCollectionByNameOrId(playerstate.Collection)
		if err != nil {
			return err
		}
		state.Fields.Add(&core.DateField{Name: "energy_at"})
		if err := app.Save(state); err != nil {
			return err
		}
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		zero, maxLevel, maxCount := 0.0, 10.0, 10000.0
		machines := core.NewBaseCollection("room_machines")
		machines.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "unit", Required: true, Max: 40},
			&core.NumberField{Name: "item_id", OnlyInt: true, Min: &zero},
			&core.NumberField{Name: "level", OnlyInt: true, Min: &zero, Max: &maxLevel},
			&core.NumberField{Name: "parts", OnlyInt: true, Min: &zero, Max: &maxCount},
			&core.NumberField{Name: "runs", OnlyInt: true, Min: &zero, Max: &maxCount},
			&core.DateField{Name: "activated_at"},
			&core.BoolField{Name: "broken"},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		machines.AddIndex("idx_room_machines_unit", true, "user, unit", "")
		return app.Save(machines)
	}, func(app core.App) error {
		if machines, err := app.FindCollectionByNameOrId("room_machines"); err == nil {
			if err := app.Delete(machines); err != nil {
				return err
			}
		}
		state, err := app.FindCollectionByNameOrId(playerstate.Collection)
		if err != nil {
			return err
		}
		state.Fields.RemoveByName("energy_at")
		return app.Save(state)
	})
}

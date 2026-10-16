package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Sprint 16: the neighbourhood. neighbor_helps counts each player's help in a
// neighbour's café per São Paulo day (one row per user, neighbour and day);
// player_gifts keeps the daily gifts (sender, recipient, item, day sent and the
// day it was opened). The non-player neighbours' users are created on their
// first visit (database/neighbors.go), so new neighbours in the rules need no
// migration.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		zero := 0.0
		helps := core.NewBaseCollection("neighbor_helps")
		helps.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "neighbor", Required: true, Max: 15},
			&core.TextField{Name: "day", Required: true, Max: 10, Pattern: `^\d{4}-\d{2}-\d{2}$`},
			&core.NumberField{Name: "count", OnlyInt: true, Min: &zero},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		helps.AddIndex("idx_neighbor_helps_day", true, "user, neighbor, day", "")
		if err := app.Save(helps); err != nil {
			return err
		}
		gifts := core.NewBaseCollection("player_gifts")
		gifts.Fields.Add(
			&core.TextField{Name: "from_user", Required: true, Max: 15},
			&core.RelationField{Name: "to_user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "item", Required: true, Max: 40},
			&core.TextField{Name: "day", Required: true, Max: 10, Pattern: `^\d{4}-\d{2}-\d{2}$`},
			&core.TextField{Name: "claimed_on", Max: 10},
			&core.DateField{Name: "claimed_at"},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		gifts.AddIndex("idx_player_gifts_to", false, "to_user, claimed_on", "")
		gifts.AddIndex("idx_player_gifts_from", false, "from_user, day", "")
		return app.Save(gifts)
	}, func(app core.App) error {
		for _, name := range []string{"player_gifts", "neighbor_helps"} {
			if collection, err := app.FindCollectionByNameOrId(name); err == nil {
				if err := app.Delete(collection); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// room_dirt: one row per plate a customer left on a table. Rows are created in
// the payment transaction and removed when the table is cleared; there are no
// public rules, only the game routes touch them.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		dirt := core.NewBaseCollection("room_dirt")
		dirt.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "table_id", Required: true, Max: 40},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		dirt.AddIndex("idx_room_dirt_table", false, "user, table_id", "")
		return app.Save(dirt)
	}, func(app core.App) error {
		dirt, err := app.FindCollectionByNameOrId("room_dirt")
		if err != nil {
			return nil
		}
		return app.Delete(dirt)
	})
}

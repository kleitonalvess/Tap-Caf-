package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// room_staff: the café's employees. Today they are predefined characters
// (gamerules staff profiles); friend_user is reserved for hiring real friends.
// No public rules: only the game routes read or write it.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		staff := core.NewBaseCollection("room_staff")
		staff.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "profile", Required: true, Max: 40},
			&core.TextField{Name: "name", Required: true, Max: 60},
			&core.SelectField{Name: "role", Required: true, MaxSelect: 1, Values: []string{"waiter", "cleaner"}},
			&core.TextField{Name: "appearance", Max: 4096},
			&core.RelationField{Name: "friend_user", CollectionId: users.Id, MaxSelect: 1},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		staff.AddIndex("idx_room_staff_owner", false, "user", "")
		staff.AddIndex("idx_room_staff_profile", true, "user, profile", "")
		return app.Save(staff)
	}, func(app core.App) error {
		staff, err := app.FindCollectionByNameOrId("room_staff")
		if err != nil {
			return nil
		}
		return app.Delete(staff)
	})
}

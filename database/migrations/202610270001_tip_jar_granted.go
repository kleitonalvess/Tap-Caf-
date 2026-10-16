package migrations

import (
	"coffe-mania/database/pbstore"
	"coffe-mania/shared/cafe"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Sprint 16: the café's tip jar (player_rooms.tip_jar, coins waiting to be
// collected), and the granted flag for cafés older than it: exactly the
// starter furniture and the floor and walls of the café's size are marked
// (cafe.MarkLegacyGranted, decision of the project owner); anything bought
// beyond that keeps its sale value.
func init() {
	m.Register(func(app core.App) error {
		rooms, err := app.FindCollectionByNameOrId("player_rooms")
		if err != nil {
			return err
		}
		zero := 0.0
		rooms.Fields.Add(&core.NumberField{Name: "tip_jar", OnlyInt: true, Min: &zero})
		if err := app.Save(rooms); err != nil {
			return err
		}
		records, err := app.FindAllRecords("player_rooms")
		if err != nil {
			return err
		}
		store := pbstore.New(app)
		for _, record := range records {
			if _, err := cafe.MarkLegacyGranted(store, record.GetString("user")); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		rooms, err := app.FindCollectionByNameOrId("player_rooms")
		if err != nil {
			return err
		}
		rooms.Fields.RemoveByName("tip_jar")
		return app.Save(rooms)
	})
}

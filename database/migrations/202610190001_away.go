package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Offline catch-up (Sprint 9): when the room fell asleep, and the summary of
// what the café did meanwhile, kept until the owner acknowledges it.
func init() {
	m.Register(func(app core.App) error {
		rooms, err := app.FindCollectionByNameOrId("player_rooms")
		if err != nil {
			return err
		}
		rooms.Fields.Add(&core.DateField{Name: "slept_at"}, &core.JSONField{Name: "away_summary", MaxSize: 4096})
		return app.Save(rooms)
	}, func(app core.App) error {
		rooms, err := app.FindCollectionByNameOrId("player_rooms")
		if err != nil {
			return err
		}
		rooms.Fields.RemoveByName("slept_at")
		rooms.Fields.RemoveByName("away_summary")
		return app.Save(rooms)
	})
}

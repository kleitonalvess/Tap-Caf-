package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Sprint 12: the counters behind achievements and daily missions
// (shared/cafe/progress.go). One row per player, with no public rules: the
// game writes it inside its own transactions and the client reads it through
// /api/coffe/progress.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		stats := core.NewBaseCollection("player_stats")
		stats.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.JSONField{Name: "counts", MaxSize: 4096},
			&core.JSONField{Name: "recipes", MaxSize: 8192},
			&core.TextField{Name: "day", Max: 10},
			&core.JSONField{Name: "day_counts", MaxSize: 4096},
			&core.JSONField{Name: "day_claimed", MaxSize: 2048},
			&core.JSONField{Name: "achievements", MaxSize: 4096},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		stats.AddIndex("idx_player_stats_user", true, "user", "")
		return app.Save(stats)
	}, func(app core.App) error {
		stats, err := app.FindCollectionByNameOrId("player_stats")
		if err != nil {
			return nil
		}
		return app.Delete(stats)
	})
}

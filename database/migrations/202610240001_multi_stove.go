package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Sprint 15a: a multi-stove's extra servings, fixed on the batch when it starts
// (shared/cafe StoveExtraServings), so moving or selling stoves never changes a batch.
func init() {
	m.Register(func(app core.App) error {
		jobs, err := app.FindCollectionByNameOrId("stove_cooking")
		if err != nil {
			return err
		}
		zero := 0.0
		jobs.Fields.Add(&core.NumberField{Name: "stove_servings", OnlyInt: true, Min: &zero})
		return app.Save(jobs)
	}, func(app core.App) error {
		jobs, err := app.FindCollectionByNameOrId("stove_cooking")
		if err != nil {
			return err
		}
		jobs.Fields.RemoveByName("stove_servings")
		return app.Save(jobs)
	})
}

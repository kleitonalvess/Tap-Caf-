package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Sprint 14: the pantry spice a batch was seasoned with (0 = none). Cancelling
// during preparation gives it back, and the stove view shows it.
func init() {
	m.Register(func(app core.App) error {
		jobs, err := app.FindCollectionByNameOrId("stove_cooking")
		if err != nil {
			return err
		}
		zero := 0.0
		jobs.Fields.Add(&core.NumberField{Name: "spice", OnlyInt: true, Min: &zero})
		return app.Save(jobs)
	}, func(app core.App) error {
		jobs, err := app.FindCollectionByNameOrId("stove_cooking")
		if err != nil {
			return err
		}
		jobs.Fields.RemoveByName("spice")
		return app.Save(jobs)
	})
}

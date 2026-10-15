package migrations

import (
	"coffe-mania/database/playerstate"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Sprint 14: the pantry of special spices (player_state.pantry, {"800001": 2}),
// the HUD's "Caixas" as free mystery crates (up to 10, so existing accounts
// keep their 4 and can collect more) and the record of each crate opening,
// keyed by the request so a retried request never draws twice.
func init() {
	m.Register(func(app core.App) error {
		state, err := app.FindCollectionByNameOrId(playerstate.Collection)
		if err != nil {
			return err
		}
		state.Fields.Add(&core.JSONField{Name: "pantry", MaxSize: 2048})
		if err := app.Save(state); err != nil {
			return err
		}
		if _, err := app.DB().NewQuery("UPDATE player_state SET crates_max = {:max} WHERE crates_max < {:max}").Bind(dbx.Params{"max": 10}).Execute(); err != nil {
			return err
		}
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		openings := core.NewBaseCollection("crate_openings")
		openings.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "request_key", Required: true, Max: 80},
			&core.TextField{Name: "crate", Required: true, Max: 40},
			&core.JSONField{Name: "result", MaxSize: 4096},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		openings.AddIndex("idx_crate_openings_request", true, "user, request_key", "")
		return app.Save(openings)
	}, func(app core.App) error {
		if openings, err := app.FindCollectionByNameOrId("crate_openings"); err == nil {
			if err := app.Delete(openings); err != nil {
				return err
			}
		}
		state, err := app.FindCollectionByNameOrId(playerstate.Collection)
		if err != nil {
			return err
		}
		state.Fields.RemoveByName("pantry")
		return app.Save(state)
	})
}

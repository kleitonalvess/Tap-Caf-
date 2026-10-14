package migrations

import (
	"coffe-mania/database/playerstate"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Sprint 11: the daily bonus (date of the last claim in São Paulo and the
// streak day it paid), the cost of each batch (cancelling refunds part of
// it) and the café's mail. Letters have no public rules; the unique key per
// player keeps a once-per-account letter from arriving twice.
func init() {
	m.Register(func(app core.App) error {
		state, err := app.FindCollectionByNameOrId(playerstate.Collection)
		if err != nil {
			return err
		}
		zero, month := 0.0, 31.0
		state.Fields.Add(
			&core.TextField{Name: "daily_claimed_on", Max: 10, Pattern: `^\d{4}-\d{2}-\d{2}$`},
			&core.NumberField{Name: "daily_streak", OnlyInt: true, Min: &zero, Max: &month},
		)
		if err := app.Save(state); err != nil {
			return err
		}
		jobs, err := app.FindCollectionByNameOrId("stove_cooking")
		if err != nil {
			return err
		}
		jobs.Fields.Add(&core.NumberField{Name: "cost_coins", OnlyInt: true, Min: &zero})
		if err := app.Save(jobs); err != nil {
			return err
		}
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		mail := core.NewBaseCollection("player_mail")
		mail.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "key", Required: true, Max: 40},
			&core.TextField{Name: "title", Required: true, Max: 80},
			&core.TextField{Name: "body", Max: 600},
			&core.NumberField{Name: "coins", OnlyInt: true, Min: &zero},
			&core.NumberField{Name: "cash", OnlyInt: true, Min: &zero},
			&core.DateField{Name: "claimed_at"},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		mail.AddIndex("idx_player_mail_key", true, "user, key", "")
		return app.Save(mail)
	}, func(app core.App) error {
		if mail, err := app.FindCollectionByNameOrId("player_mail"); err == nil {
			if err := app.Delete(mail); err != nil {
				return err
			}
		}
		if jobs, err := app.FindCollectionByNameOrId("stove_cooking"); err == nil {
			jobs.Fields.RemoveByName("cost_coins")
			if err := app.Save(jobs); err != nil {
				return err
			}
		}
		state, err := app.FindCollectionByNameOrId(playerstate.Collection)
		if err != nil {
			return err
		}
		state.Fields.RemoveByName("daily_claimed_on")
		state.Fields.RemoveByName("daily_streak")
		return app.Save(state)
	})
}

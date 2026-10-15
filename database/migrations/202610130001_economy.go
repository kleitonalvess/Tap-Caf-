package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		foods, err := app.FindCollectionByNameOrId("room_food")
		if err != nil {
			return err
		}
		// Older dishes keep 0 here and are read as a single serving.
		zero := float64(0)
		foods.Fields.Add(&core.NumberField{Name: "servings", OnlyInt: true, Min: &zero})
		if err = app.Save(foods); err != nil {
			return err
		}

		states, err := app.FindCollectionByNameOrId("player_state")
		if err != nil {
			return err
		}
		// The reference level table (shared/gamerules) ends at level 260.
		maxLevel := float64(260)
		states.Fields.GetByName("level").(*core.NumberField).Max = &maxLevel
		if err = app.Save(states); err != nil {
			return err
		}
		// experience_current now stores total XP. The old 2500/10000 starter values
		// were display placeholders and would grant level 14 on the first payment;
		// 7 is the level 2 requirement.
		_, err = app.DB().NewQuery("UPDATE player_state SET experience_current = 0, experience_max = 7 WHERE level = 1 AND experience_current = 2500 AND experience_max = 10000").Execute()
		return err
	}, nil)
}

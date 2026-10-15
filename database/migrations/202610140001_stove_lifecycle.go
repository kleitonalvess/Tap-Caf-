package migrations

import (
	"coffe-mania/shared/roomcatalog"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Serving counter added with the stove lifecycle (catalog id 3080000).
const counterItemID = 3080000

func init() {
	m.Register(func(app core.App) error {
		jobs, err := app.FindCollectionByNameOrId("stove_cooking")
		if err != nil {
			return err
		}
		zero := float64(0)
		// Empty spoils_at (older jobs) is derived from ready_at and the recipe.
		jobs.Fields.Add(
			&core.DateField{Name: "spoils_at"},
			&core.NumberField{Name: "bonus_servings", OnlyInt: true, Min: &zero},
			&core.TextField{Name: "seasoned_by", Max: 40},
		)
		if err = app.Save(jobs); err != nil {
			return err
		}
		foods, err := app.FindCollectionByNameOrId("room_food")
		if err != nil {
			return err
		}
		// Older dishes have no counter; customers still take them.
		foods.Fields.Add(&core.TextField{Name: "counter", Max: 40})
		if err = app.Save(foods); err != nil {
			return err
		}

		// Existing rooms receive the starter counter, placed beside the starter
		// stove when that tile is free, otherwise kept in the inventory.
		inventory, err := app.FindCollectionByNameOrId("player_inventory")
		if err != nil {
			return err
		}
		rooms, err := app.FindRecordsByFilter("player_rooms", "", "", 0, 0)
		if err != nil {
			return err
		}
		for _, room := range rooms {
			user := room.GetString("user")
			units, err := app.FindRecordsByFilter("player_inventory", "user={:user} && placed=true && layer='object'", "", 0, 0, dbx.Params{"user": user})
			if err != nil {
				return err
			}
			free := room.GetInt("tiles_x") > 7 && room.GetInt("tiles_y") > 3
			for _, unit := range units {
				item, ok := roomcatalog.ByID(unit.GetInt("item_id"))
				if !ok {
					continue
				}
				sx, sy := item.SizeX, item.SizeY
				if unit.GetInt("rotation")%2 == 1 {
					sx, sy = sy, sx
				}
				x, y := unit.GetInt("tx"), unit.GetInt("ty")
				if 7 >= x && 7 < x+sx && 3 >= y && 3 < y+sy {
					free = false
				}
			}
			counter := core.NewRecord(inventory)
			counter.Load(map[string]any{"user": user, "item_id": counterItemID, "layer": "object", "tx": 7, "ty": 3, "rotation": 0, "placed": free})
			if err = app.Save(counter); err != nil {
				return err
			}
			room.Set("revision", room.GetInt("revision")+1)
			if err = app.Save(room); err != nil {
				return err
			}
		}
		return nil
	}, nil)
}

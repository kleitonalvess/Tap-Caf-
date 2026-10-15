package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Sprint 13: stoves are sold in the store. The cooking table kept a unique
// index on each stove's tile, but a stored stove keeps its last tile there, so
// a second stove bought or moved onto that tile would fail. Placement is
// already validated on the inventory, which is where tiles must be unique.
func init() {
	m.Register(func(app core.App) error {
		stoves, err := app.FindCollectionByNameOrId("player_stoves")
		if err != nil {
			return err
		}
		stoves.RemoveIndex("idx_player_stoves_location")
		stoves.AddIndex("idx_player_stoves_location", false, "user, tx, ty", "")
		return app.Save(stoves)
	}, func(app core.App) error {
		// Fails (and changes nothing) once two stoves share a tile, which this
		// version allows; such a database cannot go back without moving them.
		stoves, err := app.FindCollectionByNameOrId("player_stoves")
		if err != nil {
			return err
		}
		stoves.RemoveIndex("idx_player_stoves_location")
		stoves.AddIndex("idx_player_stoves_location", true, "user, tx, ty", "")
		return app.Save(stoves)
	})
}

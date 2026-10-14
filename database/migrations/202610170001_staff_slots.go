package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// player_rooms.staff_slots counts the employee slots already paid for: the
// fee is charged once per slot, so dismissing and hiring again is free.
// Employees hired before the fee existed keep their slots.
func init() {
	m.Register(func(app core.App) error {
		rooms, err := app.FindCollectionByNameOrId("player_rooms")
		if err != nil {
			return err
		}
		min := 0.0
		rooms.Fields.Add(&core.NumberField{Name: "staff_slots", OnlyInt: true, Min: &min})
		if err := app.Save(rooms); err != nil {
			return err
		}
		records, err := app.FindAllRecords(rooms)
		if err != nil {
			return err
		}
		for _, room := range records {
			hired, err := app.CountRecords("room_staff", dbx.HashExp{"user": room.GetString("user")})
			if err != nil {
				return err
			}
			if hired > 0 {
				room.Set("staff_slots", hired)
				if err := app.Save(room); err != nil {
					return err
				}
			}
		}
		return nil
	}, func(app core.App) error {
		rooms, err := app.FindCollectionByNameOrId("player_rooms")
		if err != nil {
			return err
		}
		rooms.Fields.RemoveByName("staff_slots")
		return app.Save(rooms)
	})
}

package main

import (
	"encoding/json"
	"errors"
	"testing"

	"coffe-mania/database/appearance"
	"coffe-mania/database/playerstate"
	"coffe-mania/shared/gamewire"

	"github.com/pocketbase/pocketbase/core"
)

func setLevel(t *testing.T, app core.App, owner string, level int) {
	t.Helper()
	state, err := playerstate.GetOrCreate(app, owner)
	if err != nil {
		t.Fatal(err)
	}
	state.Set("level", level)
	if err = app.Save(state); err != nil {
		t.Fatal(err)
	}
}

func TestHiringRespectsTheLevelSlots(t *testing.T) {
	app, owner, _ := newKitchen(t)
	if err := hireStaff(app, owner, "vostu", ""); err != nil {
		t.Fatal(err)
	}
	if err := hireStaff(app, owner, "juninho", "waiter"); !errors.Is(err, errStaffSlots) {
		t.Fatalf("second employee at level 1: %v", err)
	}
	setLevel(t, app, owner, 15)
	if err := hireStaff(app, owner, "vostu", ""); !errors.Is(err, errStaffHired) {
		t.Fatalf("hiring the same character twice: %v", err)
	}
	if err := hireStaff(app, owner, "dona_cida", "pilot"); !errors.Is(err, errStaffRole) {
		t.Fatalf("unknown role: %v", err)
	}
	if err := hireStaff(app, owner, "nobody", ""); !errors.Is(err, errStaffProfile) {
		t.Fatalf("unknown profile: %v", err)
	}
	if err := hireStaff(app, owner, "dona_cida", ""); err != nil {
		t.Fatal(err)
	}
	snapshot, err := snapshotStaff(app, owner)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Slots != 3 || snapshot.NextSlotLevel != 23 || len(snapshot.Staff) != 2 || snapshot.Staff[1].Role != "cleaner" {
		t.Fatalf("snapshot = %+v", snapshot)
	}
}

func TestHiredStaffKeepsALookAndJoinsTheWorld(t *testing.T) {
	app, owner, _ := newKitchen(t)
	if err := hireStaff(app, owner, "vostu", ""); err != nil {
		t.Fatal(err)
	}
	world, err := publicWorld(app, owner)
	if err != nil {
		t.Fatal(err)
	}
	if len(world.Staff) != 1 || world.Staff[0].Role != "waiter" || world.Staff[0].Name != "Amigo Vostu" {
		t.Fatalf("world staff = %+v", world.Staff)
	}
	if _, err = appearance.Validate(world.Staff[0].Appearance); err != nil {
		t.Fatalf("staff look is not a valid appearance: %v", err)
	}
}

func TestStaffRoleAndDismissal(t *testing.T) {
	app, owner, _ := newKitchen(t)
	if err := hireStaff(app, owner, "vostu", ""); err != nil {
		t.Fatal(err)
	}
	staff, err := roomStaff(app, owner)
	if err != nil {
		t.Fatal(err)
	}
	id := staff[0].ID
	if err = setStaffRole(app, owner, id, "cleaner"); err != nil {
		t.Fatal(err)
	}
	if err = setStaffRole(app, owner, id, "chef"); !errors.Is(err, errStaffRole) {
		t.Fatalf("invalid role: %v", err)
	}
	if err = dismissStaff(app, "someone-else", id); !errors.Is(err, errStaffMissing) {
		t.Fatalf("dismissing another café's employee: %v", err)
	}
	if err = dismissStaff(app, owner, id); err != nil {
		t.Fatal(err)
	}
	if staff, _ = roomStaff(app, owner); len(staff) != 0 {
		t.Fatalf("staff after dismissal = %+v", staff)
	}
	// The freed slot can be used again.
	if err = hireStaff(app, owner, "juninho", ""); err != nil {
		t.Fatal(err)
	}
}

func TestStaffOperations(t *testing.T) {
	app, owner, _ := newKitchen(t)
	body, _ := json.Marshal(map[string]string{"profileId": "vostu"})
	op := gamewire.Operation{Owner: owner, User: owner, Action: "staff_hire", Body: body}
	result := persistenceOperation(app, op)
	if result.Status != 201 || result.World == nil || len(result.World.Staff) != 1 {
		t.Fatalf("hire: %d %s", result.Status, result.Body)
	}
	if result = persistenceOperation(app, op); result.Status != 409 {
		t.Fatalf("hire with no free slot: %d %s", result.Status, result.Body)
	}
	op.User = "visitor"
	if result = persistenceOperation(app, op); result.Status != 403 {
		t.Fatalf("visitor hiring: %d", result.Status)
	}
}

func TestStaffCleaningGivesNoReward(t *testing.T) {
	app, owner, _ := newKitchen(t)
	table := starterTable(t, app, owner)
	if _, err := serveCustomer(app, owner, addFood(t, app, owner, 1), table); err != nil {
		t.Fatal(err)
	}
	before, _ := playerstate.GetOrCreate(app, owner)
	if cleared, err := cleanTable(app, owner, table, false); err != nil || cleared != 1 {
		t.Fatalf("staff cleaning: %d %v", cleared, err)
	}
	after, _ := playerstate.GetOrCreate(app, owner)
	if after.GetInt64("experience_current") != before.GetInt64("experience_current") {
		t.Fatal("staff cleaning changed the owner's XP")
	}
}

package main

import (
	"time"

	"coffe-mania/database/pbstore"
	"coffe-mania/shared/cafe"
	"coffe-mania/shared/gamewire"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// The café's rules live in shared/cafe and run here on PocketBase. These
// entry points keep the routes (and the tests) next to the transactions they
// run; the standalone build calls the same cafe functions on its own store.

func pb(app core.App) cafe.Store { return pbstore.New(app) }

type roomCommand = cafe.RoomCommand
type roomSnapshot = cafe.RoomSnapshot
type roomUnit = cafe.RoomUnit

var requestKeyPattern = cafe.RequestKeyPattern

var (
	errRoomConflict  = cafe.ErrRoomConflict
	errRoomGold      = cafe.ErrRoomGold
	errRoomPosition  = cafe.ErrRoomPosition
	errRoomOwned     = cafe.ErrRoomOwned
	errRoomOperation = cafe.ErrRoomOperation
	errRoomBusy      = cafe.ErrRoomBusy
	errCounterBusy   = cafe.ErrCounterBusy

	errStoveOccupied       = cafe.ErrStoveOccupied
	errStoveNotOwned       = cafe.ErrStoveNotOwned
	errDishNotReady        = cafe.ErrDishNotReady
	errCookingCannotCancel = cafe.ErrCookingCannotCancel
	errUnknownRecipe       = cafe.ErrUnknownRecipe
	errRecipeLocked        = cafe.ErrRecipeLocked
	errCookingCoins        = cafe.ErrCookingCoins
	errStoveDirty          = cafe.ErrStoveDirty
	errDishSpoiled         = cafe.ErrDishSpoiled
	errNothingToClean      = cafe.ErrNothingToClean
	errCleaningCoins       = cafe.ErrCleaningCoins
	errNoCounter           = cafe.ErrNoCounter
	errSeasonClosed        = cafe.ErrSeasonClosed
	errAlreadySeasoned     = cafe.ErrAlreadySeasoned

	errFoodGone   = cafe.ErrFoodGone
	errTableClean = cafe.ErrTableClean
	errTableDirty = cafe.ErrTableDirty

	errFarmGrowing  = cafe.ErrFarmGrowing
	errFarmFull     = cafe.ErrFarmFull
	errPartyOn      = cafe.ErrPartyOn
	errPartyResting = cafe.ErrPartyResting

	errStaffSlots   = cafe.ErrStaffSlots
	errStaffProfile = cafe.ErrStaffProfile
	errStaffHired   = cafe.ErrStaffHired
	errStaffRole    = cafe.ErrStaffRole
	errStaffCoins   = cafe.ErrStaffCoins
	errStaffMissing = cafe.ErrStaffMissing

	errExpansionMax   = cafe.ErrExpansionMax
	errExpansionStep  = cafe.ErrExpansionStep
	errExpansionLevel = cafe.ErrExpansionLevel
	errExpansionCoins = cafe.ErrExpansionCoins
	errExpansionCash  = cafe.ErrExpansionCash
	errExpansionPay   = cafe.ErrExpansionPay
)

func ensureRoom(app core.App, userID string) error { return cafe.EnsureRoom(pb(app), userID) }

func ensureStarterStove(app core.App, userID string) error {
	return cafe.EnsureStarterStove(pb(app), userID)
}

func snapshotRoom(app core.App, userID string) (roomSnapshot, error) {
	return cafe.SnapshotRoom(pb(app), userID)
}

func mutateRoom(app core.App, userID, action string, command roomCommand) (roomSnapshot, error) {
	return cafe.MutateRoom(pb(app), userID, action, command, time.Now())
}

func snapshotCooking(app core.App, userID string, now types.DateTime) (cafe.CookingSnapshot, error) {
	return cafe.SnapshotCooking(pb(app), userID, now.Time())
}

func startCooking(app core.App, userID, stoveID, recipeID string, now types.DateTime) error {
	return cafe.StartCooking(pb(app), userID, stoveID, recipeID, now.Time())
}

func serveCooking(app core.App, userID, stoveID string, now types.DateTime) error {
	return cafe.ServeCooking(pb(app), userID, stoveID, now.Time())
}

func cancelCooking(app core.App, userID, stoveID string, now types.DateTime) (int64, error) {
	return cafe.CancelCooking(pb(app), userID, stoveID, now.Time())
}

func cleanStove(app core.App, userID, stoveID string, now types.DateTime) error {
	return cafe.CleanStove(pb(app), userID, stoveID, now.Time())
}

func seasonCooking(app core.App, owner, seasoner, stoveID string, now types.DateTime) error {
	return cafe.SeasonCooking(pb(app), owner, seasoner, stoveID, 0, now.Time())
}

func serveCustomer(app core.App, owner, foodID, tableID string) (gamewire.Payment, error) {
	return cafe.ServeCustomer(pb(app), owner, foodID, tableID, false, time.Now())
}

func serveCustomerBy(app core.App, owner, foodID, tableID string, waiter bool) (gamewire.Payment, error) {
	return cafe.ServeCustomer(pb(app), owner, foodID, tableID, waiter, time.Now())
}

func recordVerdict(app core.App, owner string, satisfied bool) (int, error) {
	return cafe.RecordVerdict(pb(app), owner, satisfied)
}

func roomDirt(app core.App, owner string) ([]gamewire.Dirt, error) {
	return cafe.RoomDirt(pb(app), owner)
}

func cleanTable(app core.App, owner, tableID string, reward bool) (int, error) {
	return cafe.CleanTable(pb(app), owner, tableID, reward)
}

func harvestFarm(app core.App, owner string, now types.DateTime) (gamewire.Street, error) {
	return cafe.HarvestFarm(pb(app), owner, now.Time())
}

func startParty(app core.App, owner string, now types.DateTime) (gamewire.Street, error) {
	return cafe.StartParty(pb(app), owner, now.Time())
}

func roomStaff(app core.App, owner string) ([]gamewire.StaffMember, error) {
	return cafe.RoomStaff(pb(app), owner)
}

func snapshotStaff(app core.App, owner string) (cafe.StaffSnapshot, error) {
	return cafe.SnapshotStaff(pb(app), owner)
}

func hireStaff(app core.App, owner, profileID, role string) error {
	return cafe.HireStaff(pb(app), owner, profileID, role, time.Now())
}

func setStaffRole(app core.App, owner, staffID, role string) error {
	return cafe.SetStaffRole(pb(app), owner, staffID, role)
}

func dismissStaff(app core.App, owner, staffID string) error {
	return cafe.DismissStaff(pb(app), owner, staffID)
}

func expandRoom(app core.App, owner string, tiles int, pay string) (cafe.ExpansionResult, error) {
	return cafe.ExpandRoom(pb(app), owner, tiles, pay, time.Now())
}

// diningSeat is a placed chair facing its table, as the offline catch-up counts them.
type diningSeat struct{ chair, table string }

func diningSeats(units []*core.Record) []diningSeat {
	records := make([]cafe.Record, len(units))
	for i, unit := range units {
		records[i] = pbstore.Wrap(unit)
	}
	seats := []diningSeat{}
	for _, seat := range cafe.DiningSeats(records) {
		seats = append(seats, diningSeat{seat.Chair, seat.Table})
	}
	return seats
}

func wakeRoom(app core.App, owner string, now time.Time) (*gamewire.AwaySummary, error) {
	return cafe.WakeRoom(pb(app), owner, now)
}

func acknowledgeAway(app core.App, owner string) error { return cafe.AcknowledgeAway(pb(app), owner) }

func publicWorld(app core.App, owner string) (gamewire.World, error) {
	return cafe.PublicWorld(pb(app), owner, time.Now())
}

func persistenceOperation(app core.App, op gamewire.Operation) gamewire.Result {
	return cafe.Operate(pb(app), op, time.Now())
}

func saveDormantRoom(app core.App, owner string, state gamewire.Sleep) error {
	return cafe.SaveDormant(pb(app), owner, state, time.Now())
}

package cafe

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
)

// PublicWorld is what the room simulation needs from storage: placed units,
// cooking, food on the counters, dirty tables, staff and the street timers.
func PublicWorld(s Store, owner string, now time.Time) (gamewire.World, error) {
	snapshot, err := SnapshotRoom(s, owner)
	if err != nil {
		return gamewire.World{}, err
	}
	street := snapshot.Street
	w := gamewire.World{RoomID: owner, Revision: snapshot.Revision, TilesX: snapshot.TilesX, TilesY: snapshot.TilesY, Units: []gamewire.Unit{}, Foods: []gamewire.Food{}, Dirt: []gamewire.Dirt{}, Staff: []gamewire.StaffMember{}, Street: &street}
	for _, u := range snapshot.Inventory {
		if u.Placed {
			w.Units = append(w.Units, gamewire.Unit{ID: u.UnitID, ItemID: u.ItemID, Placed: true, X: u.TX, Y: u.TY, Rotation: u.Rotation, StoveID: u.StoveID})
		}
	}
	cooking, err := SnapshotCooking(s, owner, now)
	if err != nil {
		return w, err
	}
	w.Cooking, _ = json.Marshal(cooking)
	foods, err := s.Find("room_food", Query{Where: Where{"user": owner}, Sort: []string{"created"}})
	if err != nil {
		return w, err
	}
	for _, food := range foods {
		w.Foods = append(w.Foods, gamewire.Food{ID: food.ID(), Recipe: food.GetString("recipe_id"), Servings: max(1, food.GetInt("servings")), CounterID: food.GetString("counter"), Fresh: food.GetInt("fresh_servings")})
	}
	if w.Dirt, err = RoomDirt(s, owner); err != nil {
		return w, err
	}
	if w.Staff, err = RoomStaff(s, owner); err != nil {
		return w, err
	}
	return w, nil
}

// Operate runs one room operation the room simulation has already validated
// (adjacency, busy actors) and answers with the result and the new world.
func Operate(s Store, op gamewire.Operation, now time.Time) gamewire.Result {
	fail := func(status int, message string) gamewire.Result {
		data, _ := json.Marshal(map[string]string{"message": message})
		return gamewire.Result{Status: status, Body: data}
	}
	// Visitors may only season a friend's stove.
	if op.Owner == "" || op.User == "" || op.Owner != op.User && op.Action != "cook_season" {
		return fail(403, "Somente o dono pode alterar o quarto.")
	}
	var body any
	var err error
	switch op.Action {
	case "purchase", "move", "store":
		var command RoomCommand
		if json.Unmarshal(op.Body, &command) != nil || command.Revision == nil || !RequestKeyPattern.MatchString(command.RequestID) || (op.Action != "store" && (command.TX == nil || command.TY == nil || command.Rotation == nil)) {
			return fail(400, "Pedido inválido.")
		}
		body, err = MutateRoom(s, op.Owner, op.Action, command)
	case "cook_start", "cook_serve", "cook_cancel", "cook_clean", "cook_season":
		var command struct {
			StoveID  string `json:"stoveId"`
			RecipeID string `json:"recipeId"`
		}
		if json.Unmarshal(op.Body, &command) != nil || command.StoveID == "" {
			return fail(400, "Pedido inválido.")
		}
		switch op.Action {
		case "cook_start":
			err = StartCooking(s, op.Owner, command.StoveID, command.RecipeID, now)
		case "cook_serve":
			err = ServeCooking(s, op.Owner, command.StoveID, now)
		case "cook_cancel":
			err = CancelCooking(s, op.Owner, command.StoveID, now)
		case "cook_clean":
			err = CleanStove(s, op.Owner, command.StoveID, now)
		case "cook_season":
			err = SeasonCooking(s, op.Owner, op.User, command.StoveID, now)
		}
		if err == nil {
			body, err = SnapshotCooking(s, op.Owner, now)
		}
	case "table_clean":
		var command struct {
			TableID string `json:"tableId"`
		}
		if json.Unmarshal(op.Body, &command) != nil || command.TableID == "" {
			return fail(400, "Pedido inválido.")
		}
		var plates int
		plates, err = CleanTable(s, op.Owner, command.TableID, true)
		body = map[string]any{"tableId": command.TableID, "plates": plates, "xp": gamerules.Tables().CleaningXP}
	case "staff_hire", "staff_role", "staff_dismiss":
		var command struct {
			ProfileID string `json:"profileId"`
			StaffID   string `json:"staffId"`
			Role      string `json:"role"`
		}
		if json.Unmarshal(op.Body, &command) != nil {
			return fail(400, "Pedido inválido.")
		}
		switch op.Action {
		case "staff_hire":
			err = HireStaff(s, op.Owner, command.ProfileID, command.Role)
		case "staff_role":
			err = SetStaffRole(s, op.Owner, command.StaffID, command.Role)
		case "staff_dismiss":
			err = DismissStaff(s, op.Owner, command.StaffID)
		}
		if err == nil {
			body, err = SnapshotStaff(s, op.Owner)
		}
	case "farm_harvest":
		body, err = HarvestFarm(s, op.Owner, now)
	case "party_start":
		body, err = StartParty(s, op.Owner, now)
	case "room_expand":
		var command struct {
			Tiles int    `json:"tiles"`
			Pay   string `json:"pay"`
		}
		if json.Unmarshal(op.Body, &command) != nil || command.Tiles < 1 {
			return fail(400, "Pedido inválido.")
		}
		body, err = ExpandRoom(s, op.Owner, command.Tiles, command.Pay)
	default:
		return fail(400, "Operação desconhecida.")
	}
	if err != nil {
		status, message := errorStatus(err)
		return fail(status, message)
	}
	data, _ := json.Marshal(body)
	w, err := PublicWorld(s, op.Owner, now)
	if err != nil {
		return fail(503, "Operação salva; tente novamente para atualizar o quarto.")
	}
	status := 200
	if op.Action == "cook_start" || op.Action == "staff_hire" {
		status = 201
	}
	return gamewire.Result{Status: status, Body: data, World: &w}
}

// errorStatus maps a rule error to its HTTP status and the message shown to the player.
func errorStatus(err error) (int, string) {
	is := func(targets ...error) bool {
		for _, target := range targets {
			if errors.Is(err, target) {
				return true
			}
		}
		return false
	}
	switch {
	case is(ErrRoomOwned, ErrStoveNotOwned):
		return 404, "Item indisponível."
	case is(ErrStaffMissing):
		return 404, err.Error()
	case is(ErrStaffProfile, ErrStaffRole, ErrExpansionPay):
		return 400, err.Error()
	case is(ErrStaffSlots, ErrStaffHired, ErrStaffCoins, ErrExpansionMax, ErrExpansionStep, ErrExpansionLevel,
		ErrExpansionCoins, ErrExpansionCash, ErrFarmGrowing, ErrFarmFull, ErrPartyOn, ErrPartyResting):
		return 409, err.Error()
	case is(ErrRoomPosition):
		return 400, err.Error()
	case is(ErrStoveOccupied):
		return 409, "Fogão ocupado."
	case is(ErrDishNotReady):
		return 409, "O prato ainda não está pronto."
	case is(ErrCookingCannotCancel):
		return 409, "Este preparo não pode mais ser cancelado."
	case is(ErrUnknownRecipe):
		return 400, err.Error()
	case is(ErrRoomGold, ErrRoomConflict, ErrRoomOperation, ErrRoomBusy, ErrCounterBusy, ErrRecipeLocked, ErrCookingCoins,
		ErrStoveDirty, ErrDishSpoiled, ErrNothingToClean, ErrCleaningCoins, ErrNoCounter, ErrSeasonClosed,
		ErrAlreadySeasoned, ErrTableClean, ErrTableDirty):
		return 409, err.Error()
	default:
		return 500, "Não foi possível salvar a operação."
	}
}

// SaveDormant stores the customers of a room that fell asleep and stamps the
// instant: the offline catch-up starts there when the room wakes (WakeRoom).
func SaveDormant(s Store, owner string, state gamewire.Sleep, now time.Time) error {
	if len(state.NPCs) > 32 {
		return errors.New("too many NPCs")
	}
	return s.Transaction(func(tx Store) error {
		room, err := tx.First("player_rooms", Where{"user": owner})
		if err != nil {
			return err
		}
		existing, err := tx.Find("room_npcs", Query{Where: Where{"user": owner}})
		if err != nil {
			return err
		}
		byID := map[string]Record{}
		for _, r := range existing {
			byID[r.GetString("npc_id")] = r
		}
		seen := map[string]bool{}
		for _, npc := range state.NPCs {
			if !strings.HasPrefix(npc.ID, "npc:") || seen[npc.ID] || len(npc.Path) > 256 {
				return errors.New("invalid NPC")
			}
			seen[npc.ID] = true
			record := byID[npc.ID]
			delete(byID, npc.ID)
			if record == nil {
				if record, err = tx.New("room_npcs"); err != nil {
					return err
				}
				record.Set("user", owner)
				record.Set("npc_id", npc.ID)
			}
			record.Set("state", npc)
			if err = tx.Save(record); err != nil {
				return err
			}
		}
		for _, r := range byID {
			if err = tx.Delete(r); err != nil {
				return err
			}
		}
		room.Set("active", false)
		room.Set("human_count", 0)
		room.Set("slept_at", now)
		return tx.Save(room)
	})
}

// LoadSeed wakes the room for the simulation: the absence is replayed first,
// so the world it returns already has it.
func LoadSeed(s Store, owner string, now time.Time) (gamewire.Seed, error) {
	if err := EnsureRoom(s, owner); err != nil {
		return gamewire.Seed{}, err
	}
	away, err := WakeRoom(s, owner, now)
	if err != nil {
		return gamewire.Seed{}, err
	}
	world, err := PublicWorld(s, owner, now)
	if err != nil {
		return gamewire.Seed{}, err
	}
	rows, err := s.Find("room_npcs", Query{Where: Where{"user": owner}, Sort: []string{"id"}, Limit: 32})
	if err != nil {
		return gamewire.Seed{}, err
	}
	npcs := []gamewire.Actor{}
	for _, row := range rows {
		var npc gamewire.Actor
		if err = row.UnmarshalJSONField("state", &npc); err != nil {
			return gamewire.Seed{}, err
		}
		npcs = append(npcs, npc)
	}
	looks, err := s.NPCLooks(16)
	if err != nil {
		return gamewire.Seed{}, err
	}
	state, err := GetOrCreatePlayer(s, owner)
	if err != nil {
		return gamewire.Seed{}, err
	}
	return gamewire.Seed{World: world, NPCs: npcs, Looks: looks, PopularityTenths: state.GetInt("satisfaction_current_tenths"), Away: away}, nil
}

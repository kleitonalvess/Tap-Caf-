package cafe

import (
	"errors"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
)

var ErrStaffSlots = errors.New("Todas as vagas de funcionário estão ocupadas. Suba de nível para abrir mais.")
var ErrStaffProfile = errors.New("Funcionário indisponível.")
var ErrStaffHired = errors.New("Esse funcionário já trabalha no seu café.")
var ErrStaffRole = errors.New("Função inválida.")
var ErrStaffCoins = errors.New("Moedas insuficientes para contratar.")
var ErrStaffMissing = errors.New("Funcionário não encontrado.")

type StaffView struct {
	ID           string `json:"id"`
	Profile      string `json:"profile"`
	Name         string `json:"name"`
	Role         string `json:"role"`
	FriendUserID string `json:"friendUserId,omitempty"`
}

// StaffSnapshot is what the Funcionários window shows: slots open at the
// owner's level, who works in the café and every profile that can be hired.
// HireCoins is what the next hire costs; PaidSlots were already paid for.
type StaffSnapshot struct {
	Level         int                      `json:"level"`
	Slots         int                      `json:"slots"`
	NextSlotLevel int                      `json:"nextSlotLevel,omitempty"`
	HireCoins     int64                    `json:"hireCoins"`
	PaidSlots     int                      `json:"paidSlots"`
	SlotFees      []int64                  `json:"slotFees"`
	Staff         []StaffView              `json:"staff"`
	Profiles      []gamerules.StaffProfile `json:"profiles"`
}

func staffRecords(s Store, owner string) ([]Record, error) {
	return s.Find("room_staff", Query{Where: Where{"user": owner}, Sort: []string{"created", "id"}})
}

// RoomStaff lists the employees for the room simulation, in hiring order.
func RoomStaff(s Store, owner string) ([]gamewire.StaffMember, error) {
	records, err := staffRecords(s, owner)
	if err != nil {
		return nil, err
	}
	staff := []gamewire.StaffMember{}
	for _, record := range records {
		staff = append(staff, gamewire.StaffMember{
			ID: record.ID(), Profile: record.GetString("profile"), Name: record.GetString("name"),
			Role: record.GetString("role"), Appearance: record.GetString("appearance"),
		})
	}
	return staff, nil
}

func SnapshotStaff(s Store, owner string) (StaffSnapshot, error) {
	state, err := GetOrCreatePlayer(s, owner)
	if err != nil {
		return StaffSnapshot{}, err
	}
	if err := EnsureRoom(s, owner); err != nil {
		return StaffSnapshot{}, err
	}
	room, err := s.First("player_rooms", Where{"user": owner})
	if err != nil {
		return StaffSnapshot{}, err
	}
	level := max(1, state.GetInt("level"))
	rules := gamerules.Staff()
	snapshot := StaffSnapshot{Level: level, Slots: gamerules.EmployeeSlots(level), SlotFees: rules.HireCoins, Staff: []StaffView{}, Profiles: rules.Profiles}
	if next, ok := gamerules.NextEmployeeSlotLevel(level); ok {
		snapshot.NextSlotLevel = next
	}
	records, err := staffRecords(s, owner)
	if err != nil {
		return StaffSnapshot{}, err
	}
	snapshot.PaidSlots = max(room.GetInt("staff_slots"), len(records))
	if len(records) >= snapshot.PaidSlots {
		snapshot.HireCoins = gamerules.HireCost(snapshot.PaidSlots + 1)
	}
	for _, record := range records {
		snapshot.Staff = append(snapshot.Staff, StaffView{
			ID: record.ID(), Profile: record.GetString("profile"), Name: record.GetString("name"),
			Role: record.GetString("role"), FriendUserID: record.GetString("friend_user"),
		})
	}
	return snapshot, nil
}

// HireStaff takes a free slot for a predefined character. The look is drawn
// once from the customer wardrobe policy and kept with the employee. A slot
// never filled before charges its one-time fee (the first one is free).
func HireStaff(s Store, owner, profileID, role string) error {
	profile, ok := gamerules.StaffProfileByID(profileID)
	if !ok {
		return ErrStaffProfile
	}
	if role == "" {
		role = profile.Role
	}
	if !gamerules.ValidRole(role) {
		return ErrStaffRole
	}
	looks, err := s.NPCLooks(1)
	if err != nil {
		return err
	}
	if err := EnsureRoom(s, owner); err != nil {
		return err
	}
	return s.Transaction(func(tx Store) error {
		room, err := tx.First("player_rooms", Where{"user": owner})
		if err != nil {
			return err
		}
		state, err := GetOrCreatePlayer(tx, owner)
		if err != nil {
			return err
		}
		records, err := staffRecords(tx, owner)
		if err != nil {
			return err
		}
		if len(records) >= gamerules.EmployeeSlots(max(1, state.GetInt("level"))) {
			return ErrStaffSlots
		}
		for _, record := range records {
			if record.GetString("profile") == profileID {
				return ErrStaffHired
			}
		}
		if paid := max(room.GetInt("staff_slots"), len(records)); len(records) >= paid {
			cost := gamerules.HireCost(paid + 1)
			if state.GetInt64("gold") < cost {
				return ErrStaffCoins
			}
			if cost > 0 {
				state.Set("gold", state.GetInt64("gold")-cost)
				if err = tx.Save(state); err != nil {
					return err
				}
			}
			room.Set("staff_slots", paid+1)
			if err = tx.Save(room); err != nil {
				return err
			}
		}
		member, err := tx.New("room_staff")
		if err != nil {
			return err
		}
		setAll(member, map[string]any{"user": owner, "profile": profileID, "name": profile.Name, "role": role, "appearance": looks[0]})
		return tx.Save(member)
	})
}

func ownedStaff(s Store, owner, staffID string) (Record, error) {
	record, err := s.Get("room_staff", staffID)
	if err != nil || record.GetString("user") != owner {
		return nil, ErrStaffMissing
	}
	return record, nil
}

func SetStaffRole(s Store, owner, staffID, role string) error {
	if !gamerules.ValidRole(role) {
		return ErrStaffRole
	}
	record, err := ownedStaff(s, owner, staffID)
	if err != nil {
		return err
	}
	record.Set("role", role)
	return s.Save(record)
}

func DismissStaff(s Store, owner, staffID string) error {
	record, err := ownedStaff(s, owner, staffID)
	if err != nil {
		return err
	}
	return s.Delete(record)
}

// StaffActions maps each REST path to its room operation (owner only).
var StaffActions = map[string]string{"hire": "staff_hire", "role": "staff_role", "dismiss": "staff_dismiss"}

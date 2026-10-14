package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"coffe-mania/database/npcappearance"
	"coffe-mania/database/playerstate"
	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

var errStaffSlots = errors.New("Todas as vagas de funcionário estão ocupadas. Suba de nível para abrir mais.")
var errStaffProfile = errors.New("Funcionário indisponível.")
var errStaffHired = errors.New("Esse funcionário já trabalha no seu café.")
var errStaffRole = errors.New("Função inválida.")
var errStaffCoins = errors.New("Moedas insuficientes para contratar.")
var errStaffMissing = errors.New("Funcionário não encontrado.")

type staffView struct {
	ID           string `json:"id"`
	Profile      string `json:"profile"`
	Name         string `json:"name"`
	Role         string `json:"role"`
	FriendUserID string `json:"friendUserId,omitempty"`
}

// staffSnapshot is what the Funcionários window shows: slots open at the
// owner's level, who works in the café and every profile that can be hired.
type staffSnapshot struct {
	Level         int                      `json:"level"`
	Slots         int                      `json:"slots"`
	NextSlotLevel int                      `json:"nextSlotLevel,omitempty"`
	HireCoins     int64                    `json:"hireCoins"`
	Staff         []staffView              `json:"staff"`
	Profiles      []gamerules.StaffProfile `json:"profiles"`
}

func staffRecords(app core.App, owner string) ([]*core.Record, error) {
	return app.FindRecordsByFilter("room_staff", "user={:owner}", "created,id", 0, 0, dbx.Params{"owner": owner})
}

// roomStaff lists the employees for the room simulation, in hiring order.
func roomStaff(app core.App, owner string) ([]gamewire.StaffMember, error) {
	records, err := staffRecords(app, owner)
	if err != nil {
		return nil, err
	}
	staff := []gamewire.StaffMember{}
	for _, record := range records {
		staff = append(staff, gamewire.StaffMember{
			ID: record.Id, Profile: record.GetString("profile"), Name: record.GetString("name"),
			Role: record.GetString("role"), Appearance: record.GetString("appearance"),
		})
	}
	return staff, nil
}

func snapshotStaff(app core.App, owner string) (staffSnapshot, error) {
	state, err := playerstate.GetOrCreate(app, owner)
	if err != nil {
		return staffSnapshot{}, err
	}
	level := max(1, state.GetInt("level"))
	rules := gamerules.Staff()
	snapshot := staffSnapshot{Level: level, Slots: gamerules.EmployeeSlots(level), HireCoins: rules.HireCoins, Staff: []staffView{}, Profiles: rules.Profiles}
	if next, ok := gamerules.NextEmployeeSlotLevel(level); ok {
		snapshot.NextSlotLevel = next
	}
	records, err := staffRecords(app, owner)
	if err != nil {
		return staffSnapshot{}, err
	}
	for _, record := range records {
		snapshot.Staff = append(snapshot.Staff, staffView{
			ID: record.Id, Profile: record.GetString("profile"), Name: record.GetString("name"),
			Role: record.GetString("role"), FriendUserID: record.GetString("friend_user"),
		})
	}
	return snapshot, nil
}

// hireStaff takes a free slot for a predefined character. The look is drawn
// once from the customer wardrobe policy and kept with the employee.
func hireStaff(app core.App, owner, profileID, role string) error {
	profile, ok := gamerules.StaffProfileByID(profileID)
	if !ok {
		return errStaffProfile
	}
	if role == "" {
		role = profile.Role
	}
	if !gamerules.ValidRole(role) {
		return errStaffRole
	}
	policy, err := npcappearance.Load(app)
	if err != nil {
		return err
	}
	looks, err := npcappearance.GenerateLooks(policy, 1)
	if err != nil {
		return err
	}
	return app.RunInTransaction(func(tx core.App) error {
		state, err := playerstate.GetOrCreate(tx, owner)
		if err != nil {
			return err
		}
		records, err := staffRecords(tx, owner)
		if err != nil {
			return err
		}
		if len(records) >= gamerules.EmployeeSlots(max(1, state.GetInt("level"))) {
			return errStaffSlots
		}
		for _, record := range records {
			if record.GetString("profile") == profileID {
				return errStaffHired
			}
		}
		if cost := gamerules.Staff().HireCoins; cost > 0 {
			if state.GetInt64("gold") < cost {
				return errStaffCoins
			}
			state.Set("gold", state.GetInt64("gold")-cost)
			if err = tx.Save(state); err != nil {
				return err
			}
		}
		collection, err := tx.FindCollectionByNameOrId("room_staff")
		if err != nil {
			return err
		}
		member := core.NewRecord(collection)
		member.Load(map[string]any{"user": owner, "profile": profileID, "name": profile.Name, "role": role, "appearance": looks[0]})
		return tx.Save(member)
	})
}

func ownedStaff(app core.App, owner, staffID string) (*core.Record, error) {
	record, err := app.FindRecordById("room_staff", staffID)
	if err != nil || record.GetString("user") != owner {
		return nil, errStaffMissing
	}
	return record, nil
}

func setStaffRole(app core.App, owner, staffID, role string) error {
	if !gamerules.ValidRole(role) {
		return errStaffRole
	}
	record, err := ownedStaff(app, owner, staffID)
	if err != nil {
		return err
	}
	record.Set("role", role)
	return app.Save(record)
}

func dismissStaff(app core.App, owner, staffID string) error {
	record, err := ownedStaff(app, owner, staffID)
	if err != nil {
		return err
	}
	return app.Delete(record)
}

// staffActions maps each REST path to its room operation (owner only).
var staffActions = map[string]string{"hire": "staff_hire", "role": "staff_role", "dismiss": "staff_dismiss"}

func registerStaffRoutes(e *core.ServeEvent) {
	g := e.Router.Group("/api/coffe/staff")
	g.BindFunc(func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		return r.Next()
	})
	g.GET("", func(r *core.RequestEvent) error {
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		snapshot, err := snapshotStaff(r.App, user.Id)
		if err != nil {
			return r.InternalServerError("Não foi possível carregar os funcionários.", err)
		}
		return r.JSON(http.StatusOK, snapshot)
	})
	for path, action := range staffActions {
		action := action
		g.POST("/"+path, func(r *core.RequestEvent) error {
			user := sessionRecord(r)
			if user == nil {
				return r.UnauthorizedError("Entre para jogar.", nil)
			}
			if !strings.HasPrefix(r.Request.Header.Get("Content-Type"), "application/json") {
				return r.BadRequestError("Envie JSON.", nil)
			}
			var body struct {
				ProfileID string `json:"profileId,omitempty"`
				StaffID   string `json:"staffId,omitempty"`
				Role      string `json:"role,omitempty"`
			}
			decoder := json.NewDecoder(r.Request.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&body); err != nil {
				return r.BadRequestError("Pedido inválido.", nil)
			}
			if err := decoder.Decode(new(any)); err != io.EOF || len(body.ProfileID) > 40 || len(body.StaffID) > 40 {
				return r.BadRequestError("Pedido inválido.", nil)
			}
			command := map[string]string{"profileId": body.ProfileID, "staffId": body.StaffID, "role": body.Role}
			if roomService(r.App) != nil {
				return proxyRoomOperationAs(r, user.Id, user.Id, action, command)
			}
			data, _ := json.Marshal(command)
			result := persistenceOperation(r.App, gamewire.Operation{Owner: user.Id, User: user.Id, Action: action, Body: data})
			return r.JSON(result.Status, json.RawMessage(result.Body))
		}).Bind(apis.BodyLimit(512)).BindFunc(func(r *core.RequestEvent) error {
			// Cookie auth + mutation: require a browser same-origin Origin header.
			if r.Request.Header.Get("Origin") == "" {
				return r.ForbiddenError("Origem inválida.", nil)
			}
			return sameOrigin(r)
		})
	}
}

package cafe

import (
	"errors"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
	"coffe-mania/shared/roomcatalog"
)

// RoomMachines keeps one row per entertainment machine the player owns
// (jukebox, arcade): its level, the parts installed toward the next one, the
// instant it was switched on (empty while off), the runs since its last repair
// and whether it is broken. Everything else is derived from now.
const RoomMachines = "room_machines"

var ErrMachineMissing = errors.New("Máquina indisponível.")
var ErrMachineParts = errors.New("Você não tem Peças de Máquina. Elas saem das caixas e podem ser compradas na despensa.")
var ErrMachineCoins = errors.New("Moedas insuficientes para terminar esta melhoria.")
var ErrMachineMax = errors.New("A máquina já está no nível máximo.")
var ErrMachineBuilding = errors.New("Termine de montar a máquina com Peças de Máquina.")
var ErrMachineRunning = errors.New("A máquina está ligada. Colete a rodada antes.")
var ErrMachineNotReady = errors.New("A rodada ainda não terminou.")
var ErrMachineBroken = errors.New("A máquina quebrou e precisa de conserto.")
var ErrMachineFine = errors.New("A máquina não precisa de conserto.")
var ErrMachineIdle = errors.New("A máquina está desligada.")

// Machine states, derived by MachineState.
const (
	MachineAssembling = "assembling"
	MachineIdle       = "idle"
	MachineRunning    = "running"
	MachineReady      = "ready"
	MachineBroken     = "broken"
)

// MachinePartCode is the consumable that builds and upgrades the machines.
const MachinePartCode = 820001

// MachineView is one entertainment machine as its window shows it.
type MachineView struct {
	UnitID   string `json:"unitId"`
	ItemID   int    `json:"itemId"`
	Level    int    `json:"level"`
	MaxLevel int    `json:"maxLevel"`
	State    string `json:"state"`
	// Parts installed toward the next level and how many it takes (0 at the top).
	Parts       int    `json:"parts"`
	PartsNeeded int    `json:"partsNeeded"`
	NextCoins   int64  `json:"nextCoins"`
	ActivatedAt string `json:"activatedAt,omitempty"`
	ReadyAt     string `json:"readyAt,omitempty"`
	Runs        int    `json:"runs"`
	// What a run pays and lifts at the current level.
	RunCoins        int64 `json:"runCoins"`
	RunXP           int64 `json:"runXp"`
	PatiencePercent int   `json:"patiencePercent"`
}

// MachinesResult answers a machine action: every machine, the HUD and what a
// collected run paid.
type MachinesResult struct {
	Machines    []MachineView  `json:"machines"`
	State       PlayerSnapshot `json:"state"`
	Coins       int64          `json:"coins,omitempty"`
	XP          int64          `json:"xp,omitempty"`
	LevelReward int64          `json:"levelReward,omitempty"`
}

// MachineState derives the state of a machine row at now.
func MachineState(row Record, now time.Time) string {
	switch {
	case row.GetInt("level") < 1:
		return MachineAssembling
	case row.GetBool("broken"):
		return MachineBroken
	case row.GetTime("activated_at").IsZero():
		return MachineIdle
	case now.Before(row.GetTime("activated_at").Add(gamerules.EntertainmentRun())):
		return MachineRunning
	}
	return MachineReady
}

func machineView(row Record, now time.Time) MachineView {
	machine, _ := gamerules.EntertainmentFor(row.GetInt("item_id"))
	level := row.GetInt("level")
	view := MachineView{UnitID: row.GetString("unit"), ItemID: row.GetInt("item_id"), Level: level, MaxLevel: len(machine.Levels),
		State: MachineState(row, now), Parts: row.GetInt("parts"), Runs: row.GetInt("runs")}
	if level < len(machine.Levels) {
		view.PartsNeeded, view.NextCoins = machine.Levels[level].Parts, machine.Levels[level].Coins
	}
	if level >= 1 && level <= len(machine.Levels) {
		current := machine.Levels[level-1]
		view.RunCoins, view.RunXP, view.PatiencePercent = current.RunCoins, current.RunXP, current.PatiencePercent
	}
	if at := row.GetTime("activated_at"); !at.IsZero() {
		view.ActivatedAt = at.UTC().Format(TimeLayout)
		view.ReadyAt = at.Add(gamerules.EntertainmentRun()).UTC().Format(TimeLayout)
	}
	return view
}

// SnapshotMachines lists the owner's machines in a stable order.
func SnapshotMachines(s Store, owner string, now time.Time) ([]MachineView, error) {
	rows, err := s.Find(RoomMachines, Query{Where: Where{"user": owner}, Sort: []string{"unit"}, Limit: 1000})
	if err != nil {
		return nil, err
	}
	views := make([]MachineView, 0, len(rows))
	for _, row := range rows {
		views = append(views, machineView(row, now))
	}
	return views, nil
}

// worldMachines are the placed machines the room simulates (a running one
// lifts the customers' patience).
func worldMachines(s Store, owner string, now time.Time) ([]gamewire.Machine, error) {
	rows, err := s.Find(RoomMachines, Query{Where: Where{"user": owner}, Sort: []string{"unit"}, Limit: 1000})
	if err != nil {
		return nil, err
	}
	machines := []gamewire.Machine{}
	for _, row := range rows {
		unit, err := s.Get("player_inventory", row.GetString("unit"))
		if err != nil || !unit.GetBool("placed") {
			continue
		}
		view := machineView(row, now)
		machine := gamewire.Machine{UnitID: view.UnitID, Level: view.Level, State: view.State, PatiencePercent: view.PatiencePercent}
		if at := row.GetTime("activated_at"); !at.IsZero() {
			machine.RunUntil = at.Add(gamerules.EntertainmentRun()).UnixMilli()
		}
		machines = append(machines, machine)
	}
	return machines, nil
}

// newMachineRow starts a bought machine as a frame waiting for its parts.
func newMachineRow(tx Store, owner, unitID string, itemID int) error {
	row, err := tx.New(RoomMachines)
	if err != nil {
		return err
	}
	setAll(row, map[string]any{"user": owner, "unit": unitID, "item_id": itemID, "level": 0, "parts": 0, "runs": 0, "broken": false})
	return tx.Save(row)
}

// MachineActions are the owner's actions on an entertainment machine.
var MachineActions = map[string]string{
	"/api/coffe/machines/install": "machine_install", "/api/coffe/machines/start": "machine_start",
	"/api/coffe/machines/collect": "machine_collect", "/api/coffe/machines/repair": "machine_repair",
}

// OperateMachine installs a part, switches the machine on, collects a finished
// run or repairs it, in one transaction with the parts, coins and energy.
func OperateMachine(s Store, owner, action, unitID string, now time.Time) (MachinesResult, error) {
	var result MachinesResult
	err := s.Transaction(func(tx Store) error {
		row, err := tx.First(RoomMachines, Where{"user": owner, "unit": unitID})
		if errors.Is(err, ErrNotFound) {
			return ErrMachineMissing
		}
		if err != nil {
			return err
		}
		machine, ok := gamerules.EntertainmentFor(row.GetInt("item_id"))
		if !ok {
			return ErrMachineMissing
		}
		state, err := tx.First(PlayerCollection, Where{"user": owner})
		if err != nil {
			return err
		}
		rules := gamerules.EntertainmentRulesNow()
		level := row.GetInt("level")
		switch status := MachineState(row, now); action {
		case "machine_install":
			if level >= len(machine.Levels) {
				return ErrMachineMax
			}
			if status == MachineRunning || status == MachineReady {
				return ErrMachineRunning
			}
			if status == MachineBroken {
				return ErrMachineBroken
			}
			pantry := readPantry(state)
			if pantry[MachinePartCode] < 1 {
				return ErrMachineParts
			}
			next := machine.Levels[level]
			parts := row.GetInt("parts") + 1
			if parts >= next.Parts {
				// The last part completes the level, and its coins are paid now.
				if state.GetInt64("gold") < next.Coins {
					return ErrMachineCoins
				}
				state.Set("gold", state.GetInt64("gold")-next.Coins)
				if next.Coins > 0 {
					if err := count(tx, owner, now, gamerules.StatSpentCoins, next.Coins); err != nil {
						return err
					}
				}
				row.Set("level", level+1)
				parts = 0
			}
			row.Set("parts", parts)
			pantry[MachinePartCode]--
			writePantry(state, pantry)
		case "machine_start":
			switch status {
			case MachineAssembling:
				return ErrMachineBuilding
			case MachineBroken:
				return ErrMachineBroken
			case MachineRunning, MachineReady:
				return ErrMachineRunning
			}
			if err := SpendEnergy(state, rules.StartEnergy, now); err != nil {
				return err
			}
			row.Set("activated_at", now)
		case "machine_collect":
			switch status {
			case MachineRunning:
				return ErrMachineNotReady
			case MachineReady:
			default:
				return ErrMachineIdle
			}
			paid := machine.Levels[level-1]
			progress := Grant(state, paid.RunCoins, paid.RunXP)
			result.Coins, result.XP, result.LevelReward = paid.RunCoins, paid.RunXP, progress.LevelReward
			if err := count(tx, owner, now, gamerules.StatEarnedCoins, paid.RunCoins); err != nil {
				return err
			}
			row.Set("activated_at", "")
			runs := row.GetInt("runs") + 1
			row.Set("runs", runs)
			if runs >= rules.MaintenanceRuns {
				row.Set("broken", true)
			}
		case "machine_repair":
			if status != MachineBroken {
				return ErrMachineFine
			}
			if err := SpendEnergy(state, rules.RepairEnergy, now); err != nil {
				return err
			}
			row.Set("broken", false)
			row.Set("runs", 0)
		default:
			return ErrMachineMissing
		}
		if err := tx.Save(row); err != nil {
			return err
		}
		if err := tx.Save(state); err != nil {
			return err
		}
		result.State = PlayerView(state)
		result.Machines, err = SnapshotMachines(tx, owner, now)
		return err
	})
	return result, err
}

// isEntertainment reports whether a catalogue item is a buildable machine.
func isEntertainment(item roomcatalog.Item) bool { return item.Kind == "entertainment" }

package cafe

import (
	"errors"
	"time"

	"coffe-mania/shared/gamerules"
)

var ErrEnergyFull = errors.New("A energia já está no máximo que dá para guardar.")
var ErrEnergy = errors.New("Energia insuficiente. Ela volta com o tempo ou com um Cafezinho Turbo da despensa.")

// Energy lives in player_state as energy_current and energy_at: the stored
// value and the instant regeneration counts from. The current value is derived
// from now (one point per gamerules.EnergyRegen up to energy_max), so energy
// refills while the player is away and nothing is written per tick.
func energyNow(state Record, now time.Time) (int, time.Time) {
	rules := gamerules.Energy()
	limit := state.GetInt("energy_max")
	if limit < 1 {
		limit = rules.Max
	}
	current := state.GetInt("energy_current")
	at := state.GetTime("energy_at")
	if current >= limit {
		// Full: nothing accumulates until it is spent.
		return current, now
	}
	if at.IsZero() {
		// A row from before energy_at had a fixed bar: it counts as refilled.
		return limit, now
	}
	if !now.After(at) {
		return current, at
	}
	regen := gamerules.EnergyRegen()
	points := int(now.Sub(at) / regen)
	if current+points >= limit {
		return limit, now
	}
	return current + points, at.Add(time.Duration(points) * regen)
}

// settleEnergy writes the derived value back, keeping the partial point.
func settleEnergy(state Record, now time.Time) int {
	current, anchor := energyNow(state, now)
	state.Set("energy_current", current)
	state.Set("energy_at", anchor)
	return current
}

// SpendEnergy takes energy for an action, or refuses without changing anything.
func SpendEnergy(state Record, amount int, now time.Time) error {
	if amount <= 0 {
		return nil
	}
	current, anchor := energyNow(state, now)
	if current < amount {
		return ErrEnergy
	}
	state.Set("energy_current", current-amount)
	state.Set("energy_at", anchor)
	return nil
}

// AddEnergy refills energy from a drink: above the maximum is allowed, up to
// the cap; regeneration waits while it stays at or above the maximum.
func AddEnergy(state Record, amount int, now time.Time) {
	current := settleEnergy(state, now)
	state.Set("energy_current", min(gamerules.Energy().Cap, current+amount))
}

// RefillEnergy gives back up to amount energy without passing the maximum
// (a help in a neighbour's café); it returns what it added.
func RefillEnergy(state Record, amount int, now time.Time) int {
	current := settleEnergy(state, now)
	limit := state.GetInt("energy_max")
	if limit < 1 {
		limit = gamerules.Energy().Max
	}
	added := max(0, min(amount, limit-current))
	if added > 0 {
		state.Set("energy_current", current+added)
	}
	return added
}

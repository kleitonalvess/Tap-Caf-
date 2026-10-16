package cafe

import (
	"errors"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
)

var ErrFarmGrowing = errors.New("A horta ainda está crescendo. Volte quando a colheita estiver pronta.")
var ErrFarmFull = errors.New("Use os ingredientes frescos numa receita antes de colher de novo.")
var ErrPartyOn = errors.New("A festa já está rolando!")
var ErrPartyResting = errors.New("O pessoal ainda está descansando da última festa.")

// StreetState derives the farm and disco timers from the instants stored on
// the room; nothing is decremented over time.
func StreetState(room Record) gamewire.Street {
	s := gamewire.Street{FreshCharges: room.GetInt("fresh_charges")}
	if harvested := room.GetTime("farm_harvested_at"); !harvested.IsZero() {
		s.FarmReadyAt = unixMs(harvested.Add(gamerules.FarmCooldown()))
	}
	if started := room.GetTime("party_started_at"); !started.IsZero() {
		ends := started.Add(gamerules.PartyDuration())
		s.PartyStartedAt = unixMs(started)
		s.PartyEndsAt = unixMs(ends)
		s.PartyReadyAt = unixMs(ends.Add(gamerules.PartyCooldown()))
	}
	return s
}

// partyActive tells the payment transaction whether customers tip a party bonus.
func partyActive(room Record, now time.Time) bool {
	s := StreetState(room)
	return s.PartyActive(now.UnixMilli())
}

// HarvestFarm picks the fresh ingredients: one charge for the next batch,
// once per cooldown, never more than the farm can hold.
func HarvestFarm(s Store, owner string, now time.Time) (gamewire.Street, error) {
	var state gamewire.Street
	if err := EnsureRoom(s, owner); err != nil {
		return state, err
	}
	err := s.Transaction(func(tx Store) error {
		room, err := tx.First("player_rooms", Where{"user": owner})
		if err != nil {
			return err
		}
		current := StreetState(room)
		if current.FarmReadyAt > now.UnixMilli() {
			return ErrFarmGrowing
		}
		farm := gamerules.Street().Farm
		if current.FreshCharges >= farm.MaxCharges {
			return ErrFarmFull
		}
		room.Set("farm_harvested_at", now)
		room.Set("fresh_charges", current.FreshCharges+1)
		if err := tx.Save(room); err != nil {
			return err
		}
		if err := count(tx, owner, now, gamerules.StatHarvests, 1); err != nil {
			return err
		}
		state = StreetState(room)
		// A spice shelf in the café: a chance of a free spice with every harvest.
		shelf, err := hasPlacedKind(tx, owner, "shelf")
		if err != nil {
			return err
		}
		if chance := gamerules.Pantry().ShelfHarvestPercent; shelf && chance > 0 && RandomIntn(100) < chance {
			player, err := GetOrCreatePlayer(tx, owner)
			if err != nil {
				return err
			}
			if drawn := randomSpices(player, 1); len(drawn) == 1 {
				state.FreeSpice = drawn[0]
			}
			if err := tx.Save(player); err != nil {
				return err
			}
		}
		return nil
	})
	return state, err
}

// StartParty opens the disco: customers come more often and tip more until
// the party ends; the next one waits for the cooldown after that.
func StartParty(s Store, owner string, now time.Time) (gamewire.Street, error) {
	var state gamewire.Street
	if err := EnsureRoom(s, owner); err != nil {
		return state, err
	}
	err := s.Transaction(func(tx Store) error {
		room, err := tx.First("player_rooms", Where{"user": owner})
		if err != nil {
			return err
		}
		current := StreetState(room)
		at := now.UnixMilli()
		if current.PartyActive(at) {
			return ErrPartyOn
		}
		if current.PartyReadyAt > at {
			return ErrPartyResting
		}
		room.Set("party_started_at", now)
		if err := tx.Save(room); err != nil {
			return err
		}
		if err := count(tx, owner, now, gamerules.StatParties, 1); err != nil {
			return err
		}
		state = StreetState(room)
		return nil
	})
	return state, err
}

// StreetActions are the owner-only actions on the street buildings, by REST path.
var StreetActions = map[string]string{"/api/coffe/street/farm/harvest": "farm_harvest", "/api/coffe/street/disco/party": "party_start"}

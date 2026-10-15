package cafe

import (
	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/roomcatalog"
)

// placedItemIDs lists the catalogue item of every placed unit of the café.
func placedItemIDs(s Store, owner string) ([]int, error) {
	units, err := s.Find("player_inventory", Query{Where: Where{"user": owner, "placed": true}, Limit: 10000})
	if err != nil {
		return nil, err
	}
	ids := make([]int, 0, len(units))
	for _, unit := range units {
		ids = append(ids, unit.GetInt("item_id"))
	}
	return ids, nil
}

// hasPlacedKind reports whether a unit of the kind is placed in the café.
func hasPlacedKind(s Store, owner, kind string) (bool, error) {
	units, err := s.Find("player_inventory", Query{Where: Where{"user": owner, "placed": true, "layer": "object"}, Limit: 10000})
	if err != nil {
		return false, err
	}
	for _, unit := range units {
		if item, ok := roomcatalog.ByID(unit.GetInt("item_id")); ok && item.Kind == kind {
			return true, nil
		}
	}
	return false, nil
}

// RoomDecor is the café's decoration bonus as of its placed units.
func RoomDecor(s Store, owner string) (gamerules.DecorSummary, error) {
	ids, err := placedItemIDs(s, owner)
	if err != nil {
		return gamerules.DecorSummary{}, err
	}
	return gamerules.DecorBonus(ids), nil
}

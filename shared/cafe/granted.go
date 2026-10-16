package cafe

import (
	"sort"

	"coffe-mania/shared/roomcatalog"
)

// MarkLegacyGranted marks as granted the units an account received before the
// granted flag existed (decision of the project owner, Sprint 16): exactly the
// starter furniture and the floor and walls that the café's size accounts
// for. Everything beyond that quota was bought and keeps its sale value.
//
// Quotas: the starter furniture counts per item; the structure counts per
// kind for the current size: (tx−1)(ty−1) floor tiles, (tx−1)+(ty−1) wall
// segments plus the corner, and as many wallpapers as segments (expansions
// copied the most used floor and wallpaper, so their item ids are unknown).
// Units already granted count first; the rest of a quota goes to the oldest
// units of the most common item, the best guess for what came with the café.
// It is idempotent: a café whose quotas are met changes nothing.
func MarkLegacyGranted(s Store, owner string) (int, error) {
	marked := 0
	err := s.Transaction(func(tx Store) error {
		room, err := tx.First("player_rooms", Where{"user": owner})
		if err != nil {
			return err
		}
		units, err := tx.Find("player_inventory", Query{Where: Where{"user": owner}, Sort: []string{"created", "id"}, Limit: 10000})
		if err != nil {
			return err
		}
		furniture := map[int]int{}
		for _, starter := range starterRoom {
			furniture[starter[0]]++
		}
		x, y := max(1, room.GetInt("tiles_x")), max(1, room.GetInt("tiles_y"))
		walls := (x - 1) + (y - 1)
		groups := []struct {
			quota int
			match func(item roomcatalog.Item, id int) bool
		}{
			{(x - 1) * (y - 1), func(item roomcatalog.Item, _ int) bool { return roomcatalog.Layer(item) == "floor" }},
			{walls, func(_ roomcatalog.Item, id int) bool { return id == wallSegmentID }},
			{1, func(_ roomcatalog.Item, id int) bool { return id == wallCornerID }},
			{walls, func(item roomcatalog.Item, id int) bool {
				return roomcatalog.Layer(item) == "wallpaper" && id != wallSegmentID && id != wallCornerID
			}},
		}
		for id, quota := range furniture {
			groups = append(groups, struct {
				quota int
				match func(item roomcatalog.Item, id int) bool
			}{quota, func(_ roomcatalog.Item, unit int) bool { return unit == id }})
		}
		for _, group := range groups {
			candidates := []Record{}
			counts := map[int]int{}
			need := group.quota
			for _, unit := range units {
				id := unit.GetInt("item_id")
				item, ok := roomcatalog.ByID(id)
				if !ok || !group.match(item, id) {
					continue
				}
				if unit.GetBool("granted") {
					need--
					continue
				}
				candidates = append(candidates, unit)
				counts[id]++
			}
			if need <= 0 || len(candidates) == 0 {
				continue
			}
			// Most common item first, oldest first within it (Find sorted by creation).
			sort.SliceStable(candidates, func(i, j int) bool {
				a, b := candidates[i].GetInt("item_id"), candidates[j].GetInt("item_id")
				if counts[a] != counts[b] {
					return counts[a] > counts[b]
				}
				return a < b
			})
			for _, unit := range candidates[:min(need, len(candidates))] {
				unit.Set("granted", true)
				if err := tx.Save(unit); err != nil {
					return err
				}
				marked++
			}
		}
		return nil
	})
	return marked, err
}

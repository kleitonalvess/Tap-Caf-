// Package npcappearance holds the admin-owned NPC wardrobe allowlist.
package npcappearance

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

const Collection = "npc_appearance_catalog"

//go:embed catalog.json
var catalogueJSON []byte

type Entry struct {
	ItemID int    `json:"itemId"`
	Kind   string `json:"kind"`
	Slot   string `json:"slot"`
	Name   string `json:"name"`
	Colour string `json:"colour"`
}

type Snapshot struct {
	Version     int   `json:"version"`
	ItemIDs     []int `json:"itemIds"`
	SkinColours []int `json:"skinColours"`
	HairColours []int `json:"hairColours"`
}

func Entries() ([]Entry, error) {
	var entries []Entry
	err := json.Unmarshal(catalogueJSON, &entries)
	return entries, err
}

// Row is one enabled option of the allowlist: an item, or a skin or hair colour.
type Row struct {
	Kind   string
	ItemID int
	Colour string
}

// Defaults enables every catalogue entry, as the first migration does; the
// standalone build has no admin to restrict them.
func Defaults() ([]Row, error) {
	entries, err := Entries()
	if err != nil {
		return nil, err
	}
	// Same order as the server's query (by item_id).
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].ItemID < entries[j].ItemID })
	rows := make([]Row, 0, len(entries))
	for _, entry := range entries {
		rows = append(rows, Row{Kind: entry.Kind, ItemID: entry.ItemID, Colour: entry.Colour})
	}
	return rows, nil
}

// FromRows builds the policy from the enabled options, ordered by item id;
// it never silently reopens a restricted slot.
func FromRows(rows []Row) (Snapshot, error) {
	data := Snapshot{Version: 1, ItemIDs: []int{}, SkinColours: []int{}, HairColours: []int{}}
	entries, err := Entries()
	if err != nil {
		return data, err
	}
	known := make(map[int]Entry)
	slots := make(map[string]bool)
	for _, entry := range entries {
		if entry.Kind == "item" {
			known[entry.ItemID] = entry
			slots[entry.Slot] = false
		}
	}
	for _, row := range rows {
		switch row.Kind {
		case "item":
			entry, exists := known[row.ItemID]
			if !exists {
				return data, fmt.Errorf("unknown NPC wardrobe item %d", row.ItemID)
			}
			data.ItemIDs = append(data.ItemIDs, entry.ItemID)
			slots[entry.Slot] = true
		case "skin_colour", "hair_colour":
			colour, err := strconv.ParseUint(strings.TrimPrefix(row.Colour, "#"), 16, 24)
			if err != nil {
				return data, fmt.Errorf("invalid NPC colour: %w", err)
			}
			if row.Kind == "skin_colour" {
				data.SkinColours = append(data.SkinColours, int(colour))
			} else {
				data.HairColours = append(data.HairColours, int(colour))
			}
		}
	}
	for slot, available := range slots {
		if !available {
			return data, fmt.Errorf("NPC wardrobe slot %q has no enabled item", slot)
		}
	}
	if len(data.SkinColours) == 0 || len(data.HairColours) == 0 {
		return data, fmt.Errorf("NPC skin/hair palettes must not be empty")
	}
	return data, nil
}

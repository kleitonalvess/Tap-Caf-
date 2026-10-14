// Package pbstore keeps the café (shared/cafe) in PocketBase: the server's
// half of the persistence that the standalone build keeps in the browser.
package pbstore

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"coffe-mania/shared/cafe"
	"coffe-mania/shared/npcappearance"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Store runs the café on a PocketBase app; inside a transaction the app is
// the transaction's, so nested transactions join the open one.
type Store struct{ App core.App }

func New(app core.App) cafe.Store { return Store{app} }

// Record adapts a PocketBase record to cafe.Record.
type Record struct{ *core.Record }

func Wrap(record *core.Record) cafe.Record {
	if record == nil {
		return nil
	}
	return Record{record}
}

// Unwrap returns the PocketBase record behind a cafe.Record from this store.
func Unwrap(record cafe.Record) *core.Record {
	if r, ok := record.(Record); ok {
		return r.Record
	}
	return nil
}

func (r Record) ID() string { return r.Record.Id }

func (r Record) GetTime(field string) time.Time { return r.Record.GetDateTime(field).Time() }

func (r Record) Set(field string, value any) {
	if t, ok := value.(time.Time); ok {
		if t.IsZero() {
			r.Record.Set(field, "")
			return
		}
		date, err := types.ParseDateTime(t)
		if err == nil {
			r.Record.Set(field, date)
			return
		}
	}
	r.Record.Set(field, value)
}

// filter renders a Where as a PocketBase filter. Booleans are written as
// literals, as the hand-written filters did; every other value is a parameter.
func filter(where cafe.Where) (string, dbx.Params) {
	keys := make([]string, 0, len(where))
	for key := range where {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := []string{}
	params := dbx.Params{}
	for i, key := range keys {
		switch value := where[key].(type) {
		case bool:
			parts = append(parts, fmt.Sprintf("%s=%t", key, value))
		case []string:
			options := []string{}
			for j, option := range value {
				name := fmt.Sprintf("p%d_%d", i, j)
				options = append(options, fmt.Sprintf("%s={:%s}", key, name))
				params[name] = option
			}
			parts = append(parts, "("+strings.Join(options, " || ")+")")
		default:
			name := fmt.Sprintf("p%d", i)
			parts = append(parts, fmt.Sprintf("%s={:%s}", key, name))
			params[name] = value
		}
	}
	return strings.Join(parts, " && "), params
}

func (s Store) First(collection string, where cafe.Where) (cafe.Record, error) {
	if len(where) == 1 {
		for key, value := range where {
			if _, many := value.([]string); !many {
				record, err := s.App.FindFirstRecordByData(collection, key, value)
				if err != nil {
					return nil, err
				}
				return Record{record}, nil
			}
		}
	}
	expression, params := filter(where)
	record, err := s.App.FindFirstRecordByFilter(collection, expression, params)
	if err != nil {
		return nil, err
	}
	return Record{record}, nil
}

func (s Store) Find(collection string, query cafe.Query) ([]cafe.Record, error) {
	expression, params := filter(query.Where)
	records, err := s.App.FindRecordsByFilter(collection, expression, strings.Join(query.Sort, ","), query.Limit, 0, params)
	if err != nil {
		return nil, err
	}
	out := make([]cafe.Record, len(records))
	for i, record := range records {
		out[i] = Record{record}
	}
	return out, nil
}

func (s Store) Get(collection, id string) (cafe.Record, error) {
	record, err := s.App.FindRecordById(collection, id)
	if err != nil {
		return nil, err
	}
	return Record{record}, nil
}

func (s Store) New(collection string) (cafe.Record, error) {
	found, err := s.App.FindCollectionByNameOrId(collection)
	if err != nil {
		return nil, err
	}
	return Record{core.NewRecord(found)}, nil
}

func (s Store) Save(record cafe.Record) error {
	return s.App.Save(Unwrap(record))
}

func (s Store) Delete(record cafe.Record) error {
	return s.App.Delete(Unwrap(record))
}

func (s Store) Transaction(fn func(cafe.Store) error) error {
	return s.App.RunInTransaction(func(tx core.App) error { return fn(Store{tx}) })
}

// NPCPolicy reads the enabled options of the admin-owned wardrobe allowlist.
func NPCPolicy(app core.App) (npcappearance.Snapshot, error) {
	records, err := app.FindRecordsByFilter(npcappearance.Collection, "enabled = true", "item_id", 0, 0)
	if err != nil {
		return npcappearance.Snapshot{}, err
	}
	rows := make([]npcappearance.Row, len(records))
	for i, record := range records {
		rows[i] = npcappearance.Row{Kind: record.GetString("kind"), ItemID: record.GetInt("item_id"), Colour: record.GetString("colour")}
	}
	return npcappearance.FromRows(rows)
}

func (s Store) NPCLooks(count int) ([]string, error) {
	policy, err := NPCPolicy(s.App)
	if err != nil {
		return nil, err
	}
	return npcappearance.GenerateLooks(policy, count)
}

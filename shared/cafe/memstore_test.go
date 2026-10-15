package cafe

import (
	"errors"
	"reflect"
	"testing"
	"time"
)

func saveRow(t *testing.T, s Store, collection string, fields map[string]any) Record {
	t.Helper()
	record, err := s.New(collection)
	if err != nil {
		t.Fatal(err)
	}
	for field, value := range fields {
		record.Set(field, value)
	}
	if err := s.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}

func TestMemoryStoreRollsBackAFailedTransaction(t *testing.T) {
	s := NewMemoryStore()
	kept := saveRow(t, s, "room_food", map[string]any{"user": "a", "servings": 3})
	boom := errors.New("boom")
	err := s.Transaction(func(tx Store) error {
		record, err := tx.Get("room_food", kept.ID())
		if err != nil {
			return err
		}
		record.Set("servings", 1)
		if err := tx.Save(record); err != nil {
			return err
		}
		saveRow(t, tx, "room_food", map[string]any{"user": "a", "servings": 9})
		// Reads inside see the transaction's own writes.
		if rows, _ := tx.Find("room_food", Query{Where: Where{"user": "a"}}); len(rows) != 2 {
			t.Fatalf("inside: %d rows, want 2", len(rows))
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v", err)
	}
	rows, _ := s.Find("room_food", Query{Where: Where{"user": "a"}})
	if len(rows) != 1 || rows[0].GetInt("servings") != 3 {
		t.Fatalf("after rollback: %d rows, servings %d", len(rows), rows[0].GetInt("servings"))
	}
}

func TestMemoryStoreNestedTransactionsJoinAndReportCollections(t *testing.T) {
	s := NewMemoryStore()
	var commits [][]string
	s.OnCommit = func(collections []string) { commits = append(commits, collections) }
	err := s.Transaction(func(tx Store) error {
		saveRow(t, tx, "player_state", map[string]any{"user": "a", "gold": 100})
		return tx.Transaction(func(inner Store) error {
			saveRow(t, inner, "room_dirt", map[string]any{"user": "a", "table_id": "t1"})
			return nil
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(commits, [][]string{{"player_state", "room_dirt"}}) {
		t.Fatalf("commits = %v, want one with both collections", commits)
	}
	// Reads never commit.
	if _, err := s.First("player_state", Where{"user": "a"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Transaction(func(Store) error { return errors.New("no") }); err == nil {
		t.Fatal("the failure was lost")
	}
	if len(commits) != 1 {
		t.Fatalf("%d commits after a read and a failure, want 1", len(commits))
	}
}

func TestMemoryStoreQueries(t *testing.T) {
	s := NewMemoryStore()
	for _, row := range []map[string]any{
		{"user": "a", "state": "cooking", "level": 3, "fresh": true},
		{"user": "a", "state": "ready", "level": 1, "fresh": false},
		{"user": "a", "state": "spoiled", "level": 2, "fresh": true},
		{"user": "b", "state": "ready", "level": 5, "fresh": true},
	} {
		saveRow(t, s, "jobs", row)
	}
	rows, _ := s.Find("jobs", Query{Where: Where{"user": "a", "state": []string{"cooking", "ready"}}, Sort: []string{"level"}})
	if len(rows) != 2 || rows[0].GetString("state") != "ready" || rows[1].GetString("state") != "cooking" {
		t.Fatalf("one-of filter sorted by level: %v", states(rows))
	}
	rows, _ = s.Find("jobs", Query{Where: Where{"fresh": true}, Sort: []string{"created"}, Limit: 2})
	if len(rows) != 2 || rows[0].GetString("state") != "cooking" || rows[1].GetString("state") != "spoiled" {
		t.Fatalf("bool filter with limit: %v", states(rows))
	}
	if _, err := s.First("jobs", Where{"user": "c"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing row: %v", err)
	}
}

func states(rows []Record) []string {
	out := []string{}
	for _, row := range rows {
		out = append(out, row.GetString("state"))
	}
	return out
}

func TestMemoryStoreRecordsAreDetachedCopies(t *testing.T) {
	s := NewMemoryStore()
	saved := saveRow(t, s, "player_state", map[string]any{"user": "a", "gold": 100})
	saved.Set("gold", 5)
	again, _ := s.Get("player_state", saved.ID())
	if again.GetInt("gold") != 100 {
		t.Fatalf("an unsaved change leaked into the store: gold %d", again.GetInt("gold"))
	}
}

func TestMemoryStoreExportKeepsTypes(t *testing.T) {
	s := NewMemoryStore()
	when := time.Date(2026, 10, 14, 12, 30, 0, 123e6, time.UTC)
	saveRow(t, s, "player_rooms", map[string]any{
		"user": "a", "tiles_x": 10, "ratio": 1.5, "active": true, "slept_at": when,
		"away_summary": map[string]any{"served": 3, "coins": 12},
	})
	data, err := s.Export()
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadMemoryStore(data)
	if err != nil {
		t.Fatal(err)
	}
	room, err := loaded.First("player_rooms", Where{"user": "a"})
	if err != nil {
		t.Fatal(err)
	}
	var summary struct{ Served, Coins int }
	if err := room.UnmarshalJSONField("away_summary", &summary); err != nil {
		t.Fatal(err)
	}
	if room.GetInt("tiles_x") != 10 || room.GetFloat("ratio") != 1.5 || !room.GetBool("active") || !room.GetTime("slept_at").Equal(when) || summary.Served != 3 || summary.Coins != 12 {
		t.Fatalf("reloaded: tiles %d ratio %v active %v slept %v summary %+v", room.GetInt("tiles_x"), room.GetFloat("ratio"), room.GetBool("active"), room.GetTime("slept_at"), summary)
	}
	again, _ := loaded.Export()
	if string(again) != string(data) {
		t.Fatal("a second export differs from the first")
	}
	if _, err := LoadMemoryStore([]byte(`{"version":2}`)); err == nil {
		t.Fatal("an unknown save version was accepted")
	}
}

package cafe

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"coffe-mania/shared/npcappearance"
)

// MemoryStore keeps the café in memory: the standalone build saves it in the
// browser (Export/LoadMemoryStore) and tests use it as a quick store. Stored
// rows are never changed in place: a transaction copies a collection on its
// first write and swaps the copies in when it succeeds, so an error leaves
// everything as it was. One lock serializes transactions, like SQLite's writer.
type MemoryStore struct {
	mu          sync.Mutex
	collections map[string]map[string]*memRow
	seq         int64
	// The wardrobe policy has its own lock: transactions may draw looks.
	policyMu sync.Mutex
	policy   *npcappearance.Snapshot
	// OnCommit runs after every committed change, outside the lock: the
	// standalone build saves the café there (one save per game transaction).
	OnCommit func()
}

type memRow struct {
	id      string
	created time.Time
	seq     int64
	fields  map[string]any
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{collections: map[string]map[string]*memRow{}}
}

// memTx is a transaction: reads see its own writes, then the committed rows.
type memTx struct {
	store   *MemoryStore
	changed map[string]map[string]*memRow
	seq     int64
}

func (s *MemoryStore) Transaction(fn func(Store) error) error {
	s.mu.Lock()
	tx := &memTx{store: s, changed: map[string]map[string]*memRow{}, seq: s.seq}
	err := fn(tx)
	committed := false
	if err == nil && len(tx.changed) > 0 {
		for name, rows := range tx.changed {
			s.collections[name] = rows
		}
		s.seq = tx.seq
		committed = true
	}
	s.mu.Unlock()
	if committed && s.OnCommit != nil {
		s.OnCommit()
	}
	return err
}

func (s *MemoryStore) First(collection string, where Where) (Record, error) {
	var record Record
	err := s.Transaction(func(tx Store) (err error) { record, err = tx.First(collection, where); return })
	return record, err
}

func (s *MemoryStore) Find(collection string, query Query) ([]Record, error) {
	var records []Record
	err := s.Transaction(func(tx Store) (err error) { records, err = tx.Find(collection, query); return })
	return records, err
}

func (s *MemoryStore) Get(collection, id string) (Record, error) {
	var record Record
	err := s.Transaction(func(tx Store) (err error) { record, err = tx.Get(collection, id); return })
	return record, err
}

func (s *MemoryStore) New(collection string) (Record, error) { return newMemRecord(collection), nil }

func (s *MemoryStore) Save(record Record) error {
	return s.Transaction(func(tx Store) error { return tx.Save(record) })
}

func (s *MemoryStore) Delete(record Record) error {
	return s.Transaction(func(tx Store) error { return tx.Delete(record) })
}

// NPCLooks draws from the full wardrobe policy: there is no admin to restrict it.
func (s *MemoryStore) NPCLooks(count int) ([]string, error) {
	policy, err := s.NPCPolicy()
	if err != nil {
		return nil, err
	}
	return npcappearance.GenerateLooks(policy, count)
}

// NPCPolicy is the wardrobe policy the client also needs (/api/coffe/npc-appearance).
func (s *MemoryStore) NPCPolicy() (npcappearance.Snapshot, error) {
	s.policyMu.Lock()
	defer s.policyMu.Unlock()
	if s.policy == nil {
		rows, err := npcappearance.Defaults()
		if err != nil {
			return npcappearance.Snapshot{}, err
		}
		built, err := npcappearance.FromRows(rows)
		if err != nil {
			return npcappearance.Snapshot{}, err
		}
		s.policy = &built
	}
	return *s.policy, nil
}

func (t *memTx) rows(collection string) map[string]*memRow {
	if rows, ok := t.changed[collection]; ok {
		return rows
	}
	return t.store.collections[collection]
}

func (t *memTx) writable(collection string) map[string]*memRow {
	if rows, ok := t.changed[collection]; ok {
		return rows
	}
	committed := t.store.collections[collection]
	rows := make(map[string]*memRow, len(committed)+1)
	for id, row := range committed {
		rows[id] = row
	}
	t.changed[collection] = rows
	return rows
}

func (t *memTx) matching(collection string, where Where) []*memRow {
	out := []*memRow{}
	for _, row := range t.rows(collection) {
		if row.matches(where) {
			out = append(out, row)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].seq < out[j].seq })
	return out
}

func (t *memTx) First(collection string, where Where) (Record, error) {
	rows := t.matching(collection, where)
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0].record(collection), nil
}

func (t *memTx) Find(collection string, query Query) ([]Record, error) {
	rows := t.matching(collection, query.Where)
	if len(query.Sort) > 0 {
		sort.SliceStable(rows, func(i, j int) bool {
			for _, field := range query.Sort {
				if c := rows[i].compare(rows[j], field); c != 0 {
					return c < 0
				}
			}
			return false
		})
	}
	if query.Limit > 0 && len(rows) > query.Limit {
		rows = rows[:query.Limit]
	}
	out := make([]Record, len(rows))
	for i, row := range rows {
		out[i] = row.record(collection)
	}
	return out, nil
}

func (t *memTx) Get(collection, id string) (Record, error) {
	row, ok := t.rows(collection)[id]
	if !ok {
		return nil, ErrNotFound
	}
	return row.record(collection), nil
}

func (t *memTx) New(collection string) (Record, error) { return newMemRecord(collection), nil }

func (t *memTx) Save(record Record) error {
	r, ok := record.(*memRecord)
	if !ok {
		return errors.New("memory store: foreign record")
	}
	rows := t.writable(r.collection)
	row := &memRow{id: r.id, created: r.created, fields: cloneFields(r.fields)}
	if old, exists := rows[r.id]; exists {
		row.created, row.seq = old.created, old.seq
	} else {
		if row.created.IsZero() {
			row.created = time.Now().UTC().Truncate(time.Millisecond)
		}
		t.seq++
		row.seq = t.seq
	}
	r.created = row.created
	rows[r.id] = row
	return nil
}

func (t *memTx) Delete(record Record) error {
	r, ok := record.(*memRecord)
	if !ok {
		return errors.New("memory store: foreign record")
	}
	rows := t.writable(r.collection)
	if _, exists := rows[r.id]; !exists {
		return ErrNotFound
	}
	delete(rows, r.id)
	return nil
}

// Transaction inside a transaction joins it, as PocketBase does.
func (t *memTx) Transaction(fn func(Store) error) error { return fn(t) }

func (t *memTx) NPCLooks(count int) ([]string, error) { return t.store.NPCLooks(count) }

func (r *memRow) record(collection string) *memRecord {
	return &memRecord{collection: collection, id: r.id, created: r.created, fields: cloneFields(r.fields)}
}

func (r *memRow) matches(where Where) bool {
	view := memRecord{id: r.id, created: r.created, fields: r.fields}
	for field, want := range where {
		switch value := want.(type) {
		case []string:
			got, found := view.GetString(field), false
			for _, option := range value {
				found = found || got == option
			}
			if !found {
				return false
			}
		case bool:
			if view.GetBool(field) != value {
				return false
			}
		case string:
			if view.GetString(field) != value {
				return false
			}
		case int:
			if view.GetInt64(field) != int64(value) {
				return false
			}
		case int64:
			if view.GetInt64(field) != value {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func (r *memRow) compare(other *memRow, field string) int {
	switch field {
	case "id":
		return strings.Compare(r.id, other.id)
	case "created":
		return r.created.Compare(other.created)
	}
	a, b := r.fields[field], other.fields[field]
	if x, ok := a.(int64); ok {
		if y, ok := b.(int64); ok {
			return compareInts(x, y)
		}
	}
	return strings.Compare(fmt.Sprint(a), fmt.Sprint(b))
}

func compareInts(a, b int64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

func cloneFields(fields map[string]any) map[string]any {
	out := make(map[string]any, len(fields))
	for k, v := range fields {
		out[k] = v
	}
	return out
}

// memRecord is a detached copy of a row: changes reach the store on Save.
// Values are kept as string, int64, float64, bool, nil or raw JSON; dates
// are stored as PocketBase writes them (UTC, milliseconds).
type memRecord struct {
	collection string
	id         string
	created    time.Time
	fields     map[string]any
}

const idAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

// newID draws a 15-character id, the shape PocketBase uses.
func newID() string {
	buf := make([]byte, 15)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	for i, b := range buf {
		buf[i] = idAlphabet[int(b)%len(idAlphabet)]
	}
	return string(buf)
}

func newMemRecord(collection string) *memRecord {
	return &memRecord{collection: collection, id: newID(), fields: map[string]any{}}
}

func (r *memRecord) ID() string { return r.id }

func (r *memRecord) GetString(field string) string {
	if field == "id" {
		return r.id
	}
	if field == "created" {
		return FormatTime(r.created)
	}
	switch v := r.fields[field].(type) {
	case string:
		return v
	case json.RawMessage:
		return string(v)
	case int64:
		return strconv.FormatInt(v, 10)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(v)
	}
	return ""
}

func (r *memRecord) GetInt64(field string) int64 {
	switch v := r.fields[field].(type) {
	case int64:
		return v
	case float64:
		return int64(v)
	case bool:
		if v {
			return 1
		}
	case string:
		n, _ := strconv.ParseInt(v, 10, 64)
		return n
	}
	return 0
}

func (r *memRecord) GetInt(field string) int { return int(r.GetInt64(field)) }

func (r *memRecord) GetFloat(field string) float64 {
	switch v := r.fields[field].(type) {
	case float64:
		return v
	case int64:
		return float64(v)
	case bool:
		if v {
			return 1
		}
	case string:
		f, _ := strconv.ParseFloat(v, 64)
		return f
	}
	return 0
}

func (r *memRecord) GetBool(field string) bool {
	switch v := r.fields[field].(type) {
	case bool:
		return v
	case int64:
		return v != 0
	case float64:
		return v != 0
	case string:
		return v == "true" || v == "1"
	}
	return false
}

func (r *memRecord) GetTime(field string) time.Time {
	if field == "created" {
		return r.created
	}
	if value, ok := r.fields[field].(string); ok && value != "" {
		if t, err := time.Parse(TimeLayout, value); err == nil {
			return t
		}
	}
	return time.Time{}
}

func (r *memRecord) Set(field string, value any) {
	switch v := value.(type) {
	case nil:
		r.fields[field] = nil
	case time.Time:
		r.fields[field] = FormatTime(v)
	case string:
		r.fields[field] = v
	case bool:
		r.fields[field] = v
	case int:
		r.fields[field] = int64(v)
	case int32:
		r.fields[field] = int64(v)
	case int64:
		r.fields[field] = v
	case float32:
		r.fields[field] = float64(v)
	case float64:
		r.fields[field] = v
	case json.RawMessage:
		r.fields[field] = append(json.RawMessage(nil), v...)
	default:
		data, err := json.Marshal(v)
		if err != nil {
			r.fields[field] = nil
			return
		}
		r.fields[field] = json.RawMessage(data)
	}
}

func (r *memRecord) UnmarshalJSONField(field string, out any) error {
	switch v := r.fields[field].(type) {
	case json.RawMessage:
		return json.Unmarshal(v, out)
	case string:
		if v == "" {
			return nil
		}
		return json.Unmarshal([]byte(v), out)
	}
	return nil
}

// savedStore is the JSON shape of a saved café.
type savedStore struct {
	Version     int                   `json:"version"`
	Seq         int64                 `json:"seq"`
	Collections map[string][]savedRow `json:"collections"`
}

type savedRow struct {
	ID      string                     `json:"id"`
	Created string                     `json:"created"`
	Seq     int64                      `json:"seq"`
	Fields  map[string]json.RawMessage `json:"fields"`
}

// Export writes every collection as JSON.
func (s *MemoryStore) Export() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	saved := savedStore{Version: 1, Seq: s.seq, Collections: map[string][]savedRow{}}
	for name, rows := range s.collections {
		list := make([]savedRow, 0, len(rows))
		for _, row := range rows {
			fields := make(map[string]json.RawMessage, len(row.fields))
			for field, value := range row.fields {
				if raw, ok := value.(json.RawMessage); ok {
					fields[field] = raw
					continue
				}
				data, err := json.Marshal(value)
				if err != nil {
					return nil, err
				}
				fields[field] = data
			}
			list = append(list, savedRow{ID: row.id, Created: FormatTime(row.created), Seq: row.seq, Fields: fields})
		}
		sort.Slice(list, func(i, j int) bool { return list[i].Seq < list[j].Seq })
		saved.Collections[name] = list
	}
	return json.Marshal(saved)
}

// LoadMemoryStore reads a café written by Export. JSON objects and arrays are
// kept as raw JSON (the JSON fields); numbers without a fraction are integers.
func LoadMemoryStore(data []byte) (*MemoryStore, error) {
	var saved savedStore
	if err := json.Unmarshal(data, &saved); err != nil {
		return nil, err
	}
	if saved.Version != 1 {
		return nil, fmt.Errorf("memory store: unknown save version %d", saved.Version)
	}
	s := NewMemoryStore()
	s.seq = saved.Seq
	for name, list := range saved.Collections {
		rows := make(map[string]*memRow, len(list))
		for _, item := range list {
			created, _ := time.Parse(TimeLayout, item.Created)
			row := &memRow{id: item.ID, created: created, seq: item.Seq, fields: map[string]any{}}
			for field, raw := range item.Fields {
				value, err := decodeValue(raw)
				if err != nil {
					return nil, fmt.Errorf("memory store: %s.%s: %w", name, field, err)
				}
				row.fields[field] = value
			}
			rows[row.id] = row
			s.seq = max(s.seq, row.seq)
		}
		s.collections[name] = rows
	}
	return s, nil
}

func decodeValue(raw json.RawMessage) (any, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil, nil
	}
	switch trimmed[0] {
	case '"':
		var s string
		err := json.Unmarshal(trimmed, &s)
		return s, err
	case 't', 'f':
		var b bool
		err := json.Unmarshal(trimmed, &b)
		return b, err
	case '{', '[':
		return append(json.RawMessage(nil), trimmed...), nil
	}
	if bytes.ContainsAny(trimmed, ".eE") {
		var f float64
		err := json.Unmarshal(trimmed, &f)
		return f, err
	}
	var n int64
	err := json.Unmarshal(trimmed, &n)
	return n, err
}

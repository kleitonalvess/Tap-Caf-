// Package cafe holds the café's persistent rules: every game transaction
// (cooking, payments, dirty tables, staff, expansion, street buildings and the
// offline catch-up) runs here against a Store. The server keeps its data in
// PocketBase (database/pbstore); the standalone build keeps it in memory and
// saves it in the browser (MemoryStore). Both run exactly this code.
package cafe

import (
	"database/sql"
	"time"
)

// ErrNotFound is returned by First and Get when nothing matches. It is the
// standard library's sql.ErrNoRows, which PocketBase also returns.
var ErrNotFound = sql.ErrNoRows

// Record is one stored row. Times are UTC with millisecond precision, as
// PocketBase stores them; GetTime returns the zero time for an empty field.
type Record interface {
	ID() string
	GetString(field string) string
	GetInt(field string) int
	GetInt64(field string) int64
	GetFloat(field string) float64
	GetBool(field string) bool
	GetTime(field string) time.Time
	// Set stores a value; a time.Time is stored as a date (the zero time
	// clears it) and a struct or map as JSON.
	Set(field string, value any)
	UnmarshalJSONField(field string, out any) error
}

// Where matches records whose fields equal every value; a []string value
// matches any of its strings.
type Where map[string]any

// Query lists records: Sort names fields in ascending order ("created", "id"
// and record fields); Limit 0 means no limit.
type Query struct {
	Where Where
	Sort  []string
	Limit int
}

// Store is where the café lives. Transaction runs fn atomically: an error
// undoes every change, and a transaction started inside another one joins it.
type Store interface {
	First(collection string, where Where) (Record, error)
	Find(collection string, query Query) ([]Record, error)
	Get(collection, id string) (Record, error)
	// New returns an unsaved record of the collection with its id assigned.
	New(collection string) (Record, error)
	Save(Record) error
	Delete(Record) error
	Transaction(fn func(Store) error) error
	// NPCLooks draws new customer looks from the wardrobe policy kept with the data.
	NPCLooks(count int) ([]string, error)
}

func setAll(record Record, fields map[string]any) {
	for field, value := range fields {
		record.Set(field, value)
	}
}

// TimeLayout is PocketBase's date format, used in every snapshot sent to the client.
const TimeLayout = "2006-01-02 15:04:05.000Z"

// FormatTime writes a date as PocketBase does; the zero time is "".
func FormatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(TimeLayout)
}

func unixMs(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixMilli()
}

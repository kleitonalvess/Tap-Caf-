package standalone

import (
	"errors"
	"fmt"
	"time"

	"coffe-mania/shared/cafe"
)

// MaxSaveBytes bounds an imported save: a full 20×20 café is far smaller.
const MaxSaveBytes = 16 << 20

// CheckSave confirms that an imported save is a café this engine can open
// for the profile: it reads with the same decoder as a normal start and must
// hold that player's state and room. The page replaces the current café only
// after this answers nil.
func CheckSave(data []byte, profile string) error {
	_, err := loadImport(data, profile)
	return err
}

func loadImport(data []byte, profile string) (*cafe.MemoryStore, error) {
	if len(data) == 0 || len(data) > MaxSaveBytes {
		return nil, errors.New("o arquivo não tem o tamanho de um save")
	}
	if !profileID.MatchString(profile) {
		return nil, errors.New("perfil do save inválido")
	}
	store, err := cafe.LoadMemoryStore(data)
	if err != nil {
		return nil, fmt.Errorf("save ilegível: %w", err)
	}
	if _, err := store.First(cafe.PlayerCollection, cafe.Where{"user": profile}); err != nil {
		return nil, errors.New("o save não tem os dados deste jogador")
	}
	if _, err := store.First("player_rooms", cafe.Where{"user": profile}); err != nil {
		return nil, errors.New("o save não tem o quarto deste jogador")
	}
	return store, nil
}

// pausedClocks are the game instants a restored backup moves forward by the
// time the file sat unused: the café opens exactly as exported, with dishes
// still cooking, timers where they were and no expediente for the gap.
// Calendar dates (daily bonus, missions) are not clocks and stay as they are.
var pausedClocks = map[string][]string{
	"stove_cooking": {"preparing_at", "started_at", "ready_at", "spoils_at"},
	"player_rooms":  {"farm_harvested_at", "party_started_at", "slept_at"},
}

// PrepareImport checks a save and freezes it in time: every game clock moves
// forward by now − savedAt, so restoring a backup never counts the time
// between export and import as an absence (decision of the project owner).
func PrepareImport(data []byte, profile string, savedAt, now time.Time) ([]byte, error) {
	store, err := loadImport(data, profile)
	if err != nil {
		return nil, err
	}
	gap := now.Sub(savedAt)
	if savedAt.IsZero() || gap <= 0 {
		return store.Export()
	}
	err = store.Transaction(func(tx cafe.Store) error {
		for collection, fields := range pausedClocks {
			rows, err := tx.Find(collection, cafe.Query{})
			if err != nil {
				return err
			}
			for _, row := range rows {
				for _, field := range fields {
					if at := row.GetTime(field); !at.IsZero() {
						row.Set(field, at.Add(gap))
					}
				}
				if err := tx.Save(row); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return store.Export()
}

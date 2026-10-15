package standalone

import (
	"errors"
	"fmt"

	"coffe-mania/shared/cafe"
)

// MaxSaveBytes bounds an imported save: a full 20×20 café is far smaller.
const MaxSaveBytes = 16 << 20

// CheckSave confirms that an imported save is a café this engine can open
// for the profile: it reads with the same decoder as a normal start and must
// hold that player's state and room. The page replaces the current café only
// after this answers nil.
func CheckSave(data []byte, profile string) error {
	if len(data) == 0 || len(data) > MaxSaveBytes {
		return errors.New("o arquivo não tem o tamanho de um save")
	}
	if !profileID.MatchString(profile) {
		return errors.New("perfil do save inválido")
	}
	store, err := cafe.LoadMemoryStore(data)
	if err != nil {
		return fmt.Errorf("save ilegível: %w", err)
	}
	if _, err := store.First(cafe.PlayerCollection, cafe.Where{"user": profile}); err != nil {
		return errors.New("o save não tem os dados deste jogador")
	}
	if _, err := store.First("player_rooms", cafe.Where{"user": profile}); err != nil {
		return errors.New("o save não tem o quarto deste jogador")
	}
	return nil
}

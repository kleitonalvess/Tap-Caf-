package cafe

import (
	"errors"
	"slices"
	"time"

	"coffe-mania/shared/gamerules"
)

// MailCollection holds the letters a café receives. A letter's key is unique
// per player, so a letter sent "once per account" can never arrive twice.
const MailCollection = "player_mail"

const welcomeLetterKey = "welcome"

var ErrMailClaimed = errors.New("Esta carta já foi aberta.")
var ErrMailMissing = errors.New("Carta não encontrada.")

type LetterView struct {
	ID      string `json:"id"`
	Key     string `json:"key"`
	Title   string `json:"title"`
	Body    string `json:"body"`
	Coins   int64  `json:"coins"`
	Cash    int64  `json:"cash"`
	Claimed bool   `json:"claimed"`
	// Unix ms.
	Created int64 `json:"created"`
}

type MailSnapshot struct {
	// Newest first.
	Letters []LetterView `json:"letters"`
	// Letters not opened yet.
	Unread int `json:"unread"`
}

// LetterClaim is what opening a letter paid, with the new HUD values.
type LetterClaim struct {
	Letter      LetterView     `json:"letter"`
	LevelReward int64          `json:"levelReward,omitempty"`
	State       PlayerSnapshot `json:"state"`
}

func letterView(letter Record) LetterView {
	return LetterView{
		ID: letter.ID(), Key: letter.GetString("key"), Title: letter.GetString("title"), Body: letter.GetString("body"),
		Coins: letter.GetInt64("coins"), Cash: letter.GetInt64("cash"), Claimed: !letter.GetTime("claimed_at").IsZero(),
		Created: letter.GetTime("created").UnixMilli(),
	}
}

// EnsureWelcomeLetter sends the Carta de Boas-Vindas, once per account.
func EnsureWelcomeLetter(s Store, user string) error {
	return s.Transaction(func(tx Store) error {
		_, err := tx.First(MailCollection, Where{"user": user, "key": welcomeLetterKey})
		if err == nil || !errors.Is(err, ErrNotFound) {
			return err
		}
		welcome := gamerules.Mail().Welcome
		letter, err := tx.New(MailCollection)
		if err != nil {
			return err
		}
		setAll(letter, map[string]any{
			"user": user, "key": welcomeLetterKey, "title": welcome.Title, "body": welcome.Body,
			"coins": welcome.Coins, "cash": welcome.Cash,
		})
		return tx.Save(letter)
	})
}

// SnapshotMail lists the player's letters, delivering the welcome letter first.
func SnapshotMail(s Store, user string) (MailSnapshot, error) {
	if err := EnsureWelcomeLetter(s, user); err != nil {
		return MailSnapshot{}, err
	}
	rows, err := s.Find(MailCollection, Query{Where: Where{"user": user}, Sort: []string{"created", "id"}, Limit: 200})
	if err != nil {
		return MailSnapshot{}, err
	}
	snapshot := MailSnapshot{Letters: []LetterView{}}
	for _, row := range slices.Backward(rows) {
		view := letterView(row)
		if !view.Claimed {
			snapshot.Unread++
		}
		snapshot.Letters = append(snapshot.Letters, view)
	}
	return snapshot, nil
}

// ClaimLetter opens a letter and credits what it carries, once.
func ClaimLetter(s Store, user, id string, now time.Time) (LetterClaim, error) {
	var claim LetterClaim
	err := s.Transaction(func(tx Store) error {
		letter, err := tx.Get(MailCollection, id)
		if errors.Is(err, ErrNotFound) || err == nil && letter.GetString("user") != user {
			return ErrMailMissing
		}
		if err != nil {
			return err
		}
		if !letter.GetTime("claimed_at").IsZero() {
			return ErrMailClaimed
		}
		state, err := tx.First(PlayerCollection, Where{"user": user})
		if err != nil {
			return err
		}
		progress := Grant(state, letter.GetInt64("coins"), 0)
		state.Set("cash", state.GetInt64("cash")+letter.GetInt64("cash"))
		letter.Set("claimed_at", now)
		if err := tx.Save(state); err != nil {
			return err
		}
		if err := tx.Save(letter); err != nil {
			return err
		}
		claim = LetterClaim{Letter: letterView(letter), LevelReward: progress.LevelReward, State: PlayerView(state)}
		return nil
	})
	return claim, err
}

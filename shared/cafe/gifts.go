package cafe

import (
	"errors"
	"hash/fnv"
	"strings"
	"time"

	"coffe-mania/shared/gamerules"
)

// PlayerGifts holds the daily gifts between neighbours: (from_user, to_user,
// item, day sent, claimed_on, claimed_at). A non-player neighbour's own daily
// gift has no row until the player claims it.
const PlayerGifts = "player_gifts"

var ErrGiftItem = errors.New("Presente desconhecido.")
var ErrGiftSendLimit = errors.New("Você já enviou todos os presentes de hoje.")
var ErrGiftTwice = errors.New("Este vizinho já recebeu um presente seu hoje.")
var ErrGiftClaimLimit = errors.New("Você já abriu todos os presentes que dá para abrir hoje. Os outros esperam até amanhã.")
var ErrGiftMissing = errors.New("Presente indisponível.")

// npcGiftPrefix marks the daily gift of a non-player neighbour in the list.
const npcGiftPrefix = "npc:"

type GiftView struct {
	ID       string             `json:"id"`
	From     string             `json:"from"`
	FromName string             `json:"fromName"`
	Item     gamerules.GiftItem `json:"item"`
	// Unix ms when an unclaimed gift from a player expires (absent for the neighbours' daily gift).
	ExpiresAt int64 `json:"expiresAt,omitempty"`
}

type GiftsSnapshot struct {
	Received     []GiftView           `json:"received"`
	SentToday    int                  `json:"sentToday"`
	ClaimedToday int                  `json:"claimedToday"`
	Limit        int                  `json:"limit"`
	XP           int64                `json:"xp"`
	Items        []gamerules.GiftItem `json:"items"`
}

type GiftClaim struct {
	Gift        GiftView       `json:"gift"`
	XP          int64          `json:"xp"`
	LevelReward int64          `json:"levelReward,omitempty"`
	Gifts       GiftsSnapshot  `json:"gifts"`
	State       PlayerSnapshot `json:"state"`
}

// npcGiftItem is a neighbour's daily gift to this player: the same item all
// day, on the server and in the browser, without storing the draw.
func npcGiftItem(user, neighbor, day string) gamerules.GiftItem {
	items := gamerules.Gifts().Items
	h := fnv.New32a()
	_, _ = h.Write([]byte(user + "|" + neighbor + "|" + day))
	return items[int(h.Sum32()%uint32(len(items)))]
}

// giftExpiry: a gift waits DaysLimit days counted from the São Paulo day it was sent.
func giftExpiry(row Record) time.Time {
	day, err := time.ParseInLocation(time.DateOnly, row.GetString("day"), bonusZone)
	if err != nil {
		return time.Time{}
	}
	return day.AddDate(0, 0, gamerules.Gifts().DaysLimit)
}

func countGifts(s Store, where Where) (int, error) {
	rows, err := s.Find(PlayerGifts, Query{Where: where, Limit: 1000})
	return len(rows), err
}

// SnapshotGifts lists the player's waiting gifts: those from players within
// DaysLimit days, and today's gift of each non-player neighbour not yet opened.
func SnapshotGifts(s Store, user string, now time.Time) (GiftsSnapshot, error) {
	rules := gamerules.Gifts()
	today := bonusDate(now)
	result := GiftsSnapshot{Received: []GiftView{}, Limit: rules.DailyGifts, XP: rules.XP, Items: rules.Items}
	state, err := GetOrCreatePlayer(s, user)
	if err != nil {
		return result, err
	}
	if result.SentToday, err = countGifts(s, Where{"from_user": user, "day": today}); err != nil {
		return result, err
	}
	if result.ClaimedToday, err = countGifts(s, Where{"to_user": user, "claimed_on": today}); err != nil {
		return result, err
	}
	for _, n := range gamerules.NeighborsFor(state.GetInt("level")) {
		if _, err := s.First(PlayerGifts, Where{"from_user": n.ID, "to_user": user, "day": today}); err == nil {
			continue
		} else if !errors.Is(err, ErrNotFound) {
			return result, err
		}
		result.Received = append(result.Received, GiftView{ID: npcGiftPrefix + n.ID, From: n.ID, FromName: n.Name, Item: npcGiftItem(user, n.ID, today)})
	}
	rows, err := s.Find(PlayerGifts, Query{Where: Where{"to_user": user, "claimed_on": ""}, Sort: []string{"created"}, Limit: 200})
	if err != nil {
		return result, err
	}
	for _, row := range rows {
		item, ok := gamerules.GiftItemByID(row.GetString("item"))
		expires := giftExpiry(row)
		if !ok || !now.Before(expires) {
			continue
		}
		name := "Vizinho"
		if from, err := s.First(PlayerCollection, Where{"user": row.GetString("from_user")}); err == nil && strings.TrimSpace(from.GetString("cafe_name")) != "" {
			name = from.GetString("cafe_name")
		}
		result.Received = append(result.Received, GiftView{ID: row.ID(), From: row.GetString("from_user"), FromName: name, Item: item, ExpiresAt: expires.UnixMilli()})
	}
	return result, nil
}

// SendGift sends today's free gift to a neighbour: up to DailyGifts a day, one
// per neighbour. A non-player neighbour never opens it; it still counts.
func SendGift(s Store, from, to, itemID string, now time.Time) (GiftsSnapshot, error) {
	if _, ok := gamerules.GiftItemByID(itemID); !ok {
		return GiftsSnapshot{}, ErrGiftItem
	}
	today := bonusDate(now)
	err := s.Transaction(func(tx Store) error {
		neighbor, err := isNeighbor(tx, from, to)
		if err != nil {
			return err
		}
		if !neighbor {
			return ErrNotNeighbor
		}
		sent, err := countGifts(tx, Where{"from_user": from, "day": today})
		if err != nil {
			return err
		}
		if sent >= gamerules.Gifts().DailyGifts {
			return ErrGiftSendLimit
		}
		if _, err := tx.First(PlayerGifts, Where{"from_user": from, "to_user": to, "day": today}); err == nil {
			return ErrGiftTwice
		} else if !errors.Is(err, ErrNotFound) {
			return err
		}
		row, err := tx.New(PlayerGifts)
		if err != nil {
			return err
		}
		setAll(row, map[string]any{"from_user": from, "to_user": to, "item": itemID, "day": today, "claimed_on": ""})
		if err := tx.Save(row); err != nil {
			return err
		}
		return count(tx, from, now, gamerules.StatGifts, 1)
	})
	if err != nil {
		return GiftsSnapshot{}, err
	}
	return SnapshotGifts(s, from, now)
}

// ClaimGift opens a waiting gift: its item (coins, an energy drink, a machine
// part or a spice) and the gift XP, at most DailyGifts a day.
func ClaimGift(s Store, user, giftID string, now time.Time) (GiftClaim, error) {
	var claim GiftClaim
	today := bonusDate(now)
	rules := gamerules.Gifts()
	err := s.Transaction(func(tx Store) error {
		claimed, err := countGifts(tx, Where{"to_user": user, "claimed_on": today})
		if err != nil {
			return err
		}
		if claimed >= rules.DailyGifts {
			return ErrGiftClaimLimit
		}
		state, err := GetOrCreatePlayer(tx, user)
		if err != nil {
			return err
		}
		var row Record
		var view GiftView
		if npcID, ok := strings.CutPrefix(giftID, npcGiftPrefix); ok {
			neighbor, known := gamerules.NeighborByID(npcID)
			if !known || state.GetInt("level") < neighbor.MinLevel {
				return ErrGiftMissing
			}
			if _, err := tx.First(PlayerGifts, Where{"from_user": npcID, "to_user": user, "day": today}); err == nil {
				return ErrGiftMissing
			} else if !errors.Is(err, ErrNotFound) {
				return err
			}
			item := npcGiftItem(user, npcID, today)
			if row, err = tx.New(PlayerGifts); err != nil {
				return err
			}
			setAll(row, map[string]any{"from_user": npcID, "to_user": user, "item": item.ID, "day": today})
			view = GiftView{ID: giftID, From: npcID, FromName: neighbor.Name, Item: item}
		} else {
			row, err = tx.Get(PlayerGifts, giftID)
			if errors.Is(err, ErrNotFound) {
				return ErrGiftMissing
			}
			if err != nil {
				return err
			}
			item, ok := gamerules.GiftItemByID(row.GetString("item"))
			expired := !now.Before(giftExpiry(row))
			if row.GetString("to_user") != user || row.GetString("claimed_on") != "" || !ok || expired {
				return ErrGiftMissing
			}
			view = GiftView{ID: giftID, From: row.GetString("from_user"), Item: item}
		}
		row.Set("claimed_on", today)
		row.Set("claimed_at", now)
		if err := tx.Save(row); err != nil {
			return err
		}
		item := view.Item
		progress := Grant(state, item.Coins, rules.XP)
		if item.Stock > 0 {
			addSpices(state, item.Stock, 1)
		}
		if item.Spice > 0 {
			addSpices(state, item.Spice, 1)
		}
		if err := tx.Save(state); err != nil {
			return err
		}
		if item.Coins > 0 {
			if err := count(tx, user, now, gamerules.StatEarnedCoins, item.Coins); err != nil {
				return err
			}
		}
		claim = GiftClaim{Gift: view, XP: rules.XP, LevelReward: progress.LevelReward, State: PlayerView(state)}
		return nil
	})
	if err != nil {
		return claim, err
	}
	claim.Gifts, err = SnapshotGifts(s, user, now)
	return claim, err
}

// NeighborErrorStatus maps a neighbour or gift error to its HTTP status and message.
func NeighborErrorStatus(err error) (int, string) {
	switch {
	case errors.Is(err, ErrNotNeighbor), errors.Is(err, ErrGiftMissing):
		return 404, err.Error()
	case errors.Is(err, ErrGiftItem):
		return 400, err.Error()
	case errors.Is(err, ErrHelpLimit), errors.Is(err, ErrHelpSelf), errors.Is(err, ErrGiftSendLimit), errors.Is(err, ErrGiftTwice), errors.Is(err, ErrGiftClaimLimit):
		return 409, err.Error()
	}
	return 500, "Não foi possível concluir agora."
}

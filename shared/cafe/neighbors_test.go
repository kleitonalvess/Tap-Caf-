package cafe

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
)

const papa = "npcneighbor0001"

func TestNeighborsListTheNPCsAndOtherPlayers(t *testing.T) {
	s, _ := newCafe(t, "owner")
	if _, err := GetOrCreatePlayer(s, "friend"); err != nil {
		t.Fatal(err)
	}
	list, err := ListNeighbors(s, "owner", progressT0)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]NeighborView{}
	for _, n := range list.Neighbors {
		ids[n.ID] = n
	}
	if list.Neighbors[0].ID != papa || list.Neighbors[0].Special != -1 {
		t.Fatalf("the special neighbour comes first: %+v", list.Neighbors[0])
	}
	if _, ok := ids["npcneighbor0002"]; ok {
		t.Fatal("the level-69 special neighbour shows at level 1")
	}
	if friend, ok := ids["friend"]; !ok || friend.Kind != "player" || friend.HelpsLeft != gamerules.Neighbors().HelpsPerDay {
		t.Fatalf("the other player: %+v", friend)
	}
	if _, ok := ids["owner"]; ok {
		t.Fatal("the player is their own neighbour")
	}
	setPlayer(t, s, "owner", map[string]any{"level": 69, "experience_current": gamerules.Public().Levels[68].RequiredXP})
	list, _ = ListNeighbors(s, "owner", progressT0)
	if list.Neighbors[1].ID != "npcneighbor0002" {
		t.Fatalf("the second special neighbour from level 69: %+v", list.Neighbors[1])
	}
}

func TestANeighborCafeHasChoresOnEveryVisit(t *testing.T) {
	s := NewMemoryStore()
	if err := EnsureNeighborCafe(s, papa, progressT0); err != nil {
		t.Fatal(err)
	}
	state, _ := s.First(PlayerCollection, Where{"user": papa})
	neighbor, _ := gamerules.NeighborByID(papa)
	if state.GetString("cafe_name") != neighbor.CafeName || state.GetInt("level") != neighbor.Level {
		t.Fatalf("neighbour state: %s level %d", state.GetString("cafe_name"), state.GetInt("level"))
	}
	cooking, _ := SnapshotCooking(s, papa, progressT0)
	if len(cooking.Stoves) == 0 || cooking.Stoves[0].Cooking == nil || cooking.Stoves[0].Cooking.RecipeID != neighbor.Recipe {
		t.Fatalf("the neighbour's dish: %+v", cooking.Stoves)
	}
	dirt, _ := RoomDirt(s, papa)
	if len(dirt) != 2 {
		t.Fatalf("dirty tables = %d", len(dirt))
	}
	// A second visit adds nothing while the chores are still there.
	if err := EnsureNeighborCafe(s, papa, progressT0.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if again, _ := RoomDirt(s, papa); len(again) != 2 || again[0].Plates != 1 {
		t.Fatalf("second visit: %+v", again)
	}
	if err := EnsureNeighborCafe(s, "someone", progressT0); !errors.Is(err, ErrNotNeighbor) {
		t.Fatalf("a player is not a generated café: %v", err)
	}
}

func TestHelpingANeighborPaysThreeTimesADay(t *testing.T) {
	s, _ := newCafe(t, "owner")
	reward := gamerules.Neighbors().HelpReward
	setPlayer(t, s, "owner", map[string]any{"energy_current": 10, "energy_at": progressT0})
	before, _ := GetOrCreatePlayer(s, "owner")
	for i := range gamerules.Neighbors().HelpsPerDay {
		help, err := HelpNeighbor(s, "owner", papa, "cheer", progressT0)
		if err != nil || help.Coins != reward.Coins || help.XP != reward.XP || help.Energy != reward.Energy || help.HelpsLeft != gamerules.Neighbors().HelpsPerDay-i-1 {
			t.Fatalf("help %d: %+v %v", i, help, err)
		}
	}
	if _, err := HelpNeighbor(s, "owner", papa, "cheer", progressT0); !errors.Is(err, ErrHelpLimit) {
		t.Fatalf("a fourth help: %v", err)
	}
	after, _ := GetOrCreatePlayer(s, "owner")
	n := int64(gamerules.Neighbors().HelpsPerDay)
	if after.GetInt64("gold") != before.GetInt64("gold")+n*reward.Coins {
		t.Fatalf("coins %d → %d", before.GetInt64("gold"), after.GetInt64("gold"))
	}
	// Tomorrow there is help to give again; the neighbour counts once for the achievement.
	if _, err := HelpNeighbor(s, "owner", papa, "table", progressT0.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	stats, _ := s.First(StatsCollection, Where{"user": "owner"})
	if readStats(stats).counts[gamerules.StatNeighbors] != 1 {
		t.Fatalf("neighbours helped = %d", readStats(stats).counts[gamerules.StatNeighbors])
	}
	if _, err := HelpNeighbor(s, "owner", "owner", "cheer", progressT0); !errors.Is(err, ErrHelpSelf) {
		t.Fatalf("helping oneself: %v", err)
	}
	if _, err := HelpNeighbor(s, "owner", "nobody", "cheer", progressT0); !errors.Is(err, ErrNotNeighbor) {
		t.Fatalf("helping a stranger: %v", err)
	}
}

func TestVisitorsHelpByCleaningAndSeasoning(t *testing.T) {
	s, _ := newCafe(t, "owner")
	if err := EnsureNeighborCafe(s, papa, progressT0); err != nil {
		t.Fatal(err)
	}
	dirt, _ := RoomDirt(s, papa)
	body, _ := json.Marshal(map[string]string{"tableId": dirt[0].TableID})
	result := Operate(s, gamewire.Operation{Owner: papa, User: "owner", Action: "table_clean", Body: body}, progressT0)
	var cleaned struct {
		Plates int        `json:"plates"`
		Help   HelpResult `json:"help"`
	}
	if result.Status != 200 || json.Unmarshal(result.Body, &cleaned) != nil || cleaned.Plates != 1 || cleaned.Help.Coins != gamerules.Neighbors().HelpReward.Coins {
		t.Fatalf("visitor cleaning: %d %s", result.Status, result.Body)
	}
	cooking, _ := SnapshotCooking(s, papa, progressT0)
	seasonBody, _ := json.Marshal(map[string]string{"stoveId": cooking.Stoves[0].ID})
	result = Operate(s, gamewire.Operation{Owner: papa, User: "owner", Action: "cook_season", Body: seasonBody}, progressT0.Add(time.Minute))
	var seasoned CookingSnapshot
	if result.Status != 200 || json.Unmarshal(result.Body, &seasoned) != nil || seasoned.Help == nil || seasoned.Help.HelpsLeft != gamerules.Neighbors().HelpsPerDay-2 {
		t.Fatalf("visitor seasoning: %d %s", result.Status, result.Body)
	}
	// Other owner actions stay refused to visitors.
	result = Operate(s, gamewire.Operation{Owner: papa, User: "owner", Action: "cook_cancel", Body: seasonBody}, progressT0)
	if result.Status != 403 {
		t.Fatalf("a visitor cancelling: %d", result.Status)
	}
}

func TestGiftsBetweenNeighbors(t *testing.T) {
	s, _ := newCafe(t, "owner")
	if _, err := GetOrCreatePlayer(s, "friend"); err != nil {
		t.Fatal(err)
	}
	rules := gamerules.Gifts()
	gifts, err := SnapshotGifts(s, "owner", progressT0)
	if err != nil || len(gifts.Received) == 0 || gifts.Limit != rules.DailyGifts {
		t.Fatalf("waiting gifts: %+v %v", gifts, err)
	}
	npcGift := gifts.Received[0]
	before, _ := GetOrCreatePlayer(s, "owner")
	claim, err := ClaimGift(s, "owner", npcGift.ID, progressT0)
	if err != nil || claim.XP != rules.XP || claim.State.Experience.Current != before.GetFloat("experience_current")+float64(rules.XP) {
		t.Fatalf("claim the neighbour's gift: %+v %v", claim, err)
	}
	if _, err := ClaimGift(s, "owner", npcGift.ID, progressT0); !errors.Is(err, ErrGiftMissing) {
		t.Fatalf("claiming it twice: %v", err)
	}
	if again, _ := SnapshotGifts(s, "owner", progressT0); len(again.Received) != len(gifts.Received)-1 || again.ClaimedToday != 1 {
		t.Fatalf("after the claim: %d waiting, %d claimed", len(again.Received), again.ClaimedToday)
	}
	// Sending: one per neighbour a day, DailyGifts in all.
	if _, err := SendGift(s, "owner", "friend", "coins", progressT0); err != nil {
		t.Fatal(err)
	}
	if _, err := SendGift(s, "owner", "friend", "coins", progressT0); !errors.Is(err, ErrGiftTwice) {
		t.Fatalf("a second gift to the same neighbour: %v", err)
	}
	if _, err := SendGift(s, "owner", "friend", "diamonds", progressT0); !errors.Is(err, ErrGiftItem) {
		t.Fatalf("an unknown item: %v", err)
	}
	sent := 1
	for _, n := range gamerules.NeighborsFor(1) {
		if sent == rules.DailyGifts {
			if _, err := SendGift(s, "owner", n.ID, "part", progressT0); !errors.Is(err, ErrGiftSendLimit) {
				t.Fatalf("a gift over the daily limit: %v", err)
			}
			break
		}
		if _, err := SendGift(s, "owner", n.ID, "part", progressT0); err != nil {
			t.Fatal(err)
		}
		sent++
	}
	// The friend opens the coins.
	waiting, _ := SnapshotGifts(s, "friend", progressT0)
	var fromOwner GiftView
	for _, g := range waiting.Received {
		if g.From == "owner" {
			fromOwner = g
		}
	}
	friendBefore, _ := GetOrCreatePlayer(s, "friend")
	opened, err := ClaimGift(s, "friend", fromOwner.ID, progressT0)
	if err != nil || opened.State.Gold != friendBefore.GetInt64("gold")+rules.Coins {
		t.Fatalf("the friend opens the coins: %+v %v", opened, err)
	}
	// An unopened gift expires after DaysLimit days.
	if _, err := SendGift(s, "friend", "owner", "salt", progressT0); err != nil {
		t.Fatal(err)
	}
	late := progressT0.Add(time.Duration(rules.DaysLimit)*24*time.Hour + time.Hour)
	for _, g := range func() []GiftView { snap, _ := SnapshotGifts(s, "owner", late); return snap.Received }() {
		if g.From == "friend" {
			t.Fatal("an expired gift is still waiting")
		}
	}
	stats, _ := s.First(StatsCollection, Where{"user": "owner"})
	if readStats(stats).counts[gamerules.StatGifts] != int64(rules.DailyGifts) {
		t.Fatalf("gifts sent = %d", readStats(stats).counts[gamerules.StatGifts])
	}
}

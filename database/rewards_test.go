package main

import (
	"errors"
	"testing"
	"time"

	"coffe-mania/shared/cafe"
	"coffe-mania/shared/gamerules"

	"github.com/pocketbase/pocketbase/tools/types"
)

// saoPaulo builds an instant from a São Paulo wall clock (UTC-3, no DST).
func saoPaulo(day, hour int) time.Time {
	return time.Date(2026, time.October, day, hour, 0, 0, 0, time.FixedZone("BRT", -3*60*60))
}

func TestDailyBonusPaysEachDayOnce(t *testing.T) {
	app, owner := newEconomyApp(t)
	before := playerState(t, app, owner)
	gold, cash := before.GetInt64("gold"), before.GetInt64("cash")
	first, err := cafe.ClaimDaily(pb(app), owner, saoPaulo(10, 9))
	if err != nil || first.Reward.Day != 1 || first.Daily.Claimable || first.Daily.Day != 1 {
		t.Fatalf("first claim: %+v %v", first, err)
	}
	if _, err := cafe.ClaimDaily(pb(app), owner, saoPaulo(10, 23)); !errors.Is(err, cafe.ErrDailyClaimed) {
		t.Fatalf("second claim the same day: %v", err)
	}
	state := playerState(t, app, owner)
	if state.GetInt64("gold") != gold+gamerules.DailyRewardFor(1).Coins || state.GetInt64("cash") != cash {
		t.Fatalf("after day 1: gold %d cash %d", state.GetInt64("gold"), state.GetInt64("cash"))
	}
	// 02:59 UTC on the 11th is still the 10th in São Paulo.
	if daily, _ := cafe.Daily(pb(app), owner, time.Date(2026, time.October, 11, 2, 59, 0, 0, time.UTC)); daily.Claimable {
		t.Fatal("the São Paulo day changed at UTC midnight")
	}
	next, _ := cafe.Daily(pb(app), owner, saoPaulo(11, 0))
	if !next.Claimable || next.Day != 2 || next.NextAt != saoPaulo(12, 0).UnixMilli() {
		t.Fatalf("next day: %+v", next)
	}
}

func TestDailyStreakCyclesAndResets(t *testing.T) {
	app, owner := newEconomyApp(t)
	days := len(gamerules.Daily().Days)
	cash := playerState(t, app, owner).GetInt64("cash")
	var paid int64
	for i := 0; i < days; i++ {
		claim, err := cafe.ClaimDaily(pb(app), owner, saoPaulo(1+i, 20))
		if err != nil || claim.Reward.Day != i+1 {
			t.Fatalf("day %d: %+v %v", i+1, claim.Reward, err)
		}
		paid += claim.Reward.Cash
	}
	if paid == 0 || playerState(t, app, owner).GetInt64("cash") != cash+paid {
		t.Fatalf("the streak paid %d Grana; state has %d (started with %d)", paid, playerState(t, app, owner).GetInt64("cash"), cash)
	}
	after, err := cafe.ClaimDaily(pb(app), owner, saoPaulo(1+days, 8))
	if err != nil || after.Reward.Day != 1 {
		t.Fatalf("the day after the last: %+v %v", after.Reward, err)
	}
	second, _ := cafe.ClaimDaily(pb(app), owner, saoPaulo(2+days, 8))
	if second.Reward.Day != 2 {
		t.Fatalf("streak did not continue: day %d", second.Reward.Day)
	}
	// Skipping a day starts over.
	gap, _ := cafe.ClaimDaily(pb(app), owner, saoPaulo(4+days, 8))
	if gap.Reward.Day != 1 {
		t.Fatalf("after a gap: day %d", gap.Reward.Day)
	}
	// A clock moved back never pays the same date again.
	if _, err := cafe.ClaimDaily(pb(app), owner, saoPaulo(3+days, 8)); !errors.Is(err, cafe.ErrDailyClaimed) {
		t.Fatalf("claim on an earlier date: %v", err)
	}
}

func TestWelcomeLetterArrivesOnceAndPaysOnce(t *testing.T) {
	app, owner := newEconomyApp(t)
	for i := 0; i < 2; i++ {
		mail, err := cafe.SnapshotMail(pb(app), owner)
		if err != nil || len(mail.Letters) != 1 || mail.Unread != 1 || mail.Letters[0].Title != gamerules.Mail().Welcome.Title {
			t.Fatalf("mail (read %d): %+v %v", i+1, mail, err)
		}
	}
	letters, err := app.FindRecordsByFilter(cafe.MailCollection, "user={:user}", "", 0, 0, map[string]any{"user": owner})
	if err != nil || len(letters) != 1 {
		t.Fatalf("%d welcome letters stored: %v", len(letters), err)
	}
	gold := playerState(t, app, owner).GetInt64("gold")
	claim, err := cafe.ClaimLetter(pb(app), owner, letters[0].Id, time.Now())
	if err != nil || !claim.Letter.Claimed || claim.State.Gold != gold+gamerules.Mail().Welcome.Coins {
		t.Fatalf("claim: %+v %v", claim, err)
	}
	if _, err := cafe.ClaimLetter(pb(app), owner, letters[0].Id, time.Now()); !errors.Is(err, cafe.ErrMailClaimed) {
		t.Fatalf("second claim: %v", err)
	}
	if mail, _ := cafe.SnapshotMail(pb(app), owner); mail.Unread != 0 || len(mail.Letters) != 1 {
		t.Fatalf("after claiming: %+v", mail)
	}
	if _, err := cafe.ClaimLetter(pb(app), "someoneelse0001", letters[0].Id, time.Now()); !errors.Is(err, cafe.ErrMailMissing) {
		t.Fatalf("someone else's letter: %v", err)
	}
	if _, err := cafe.ClaimLetter(pb(app), owner, "missing00000001", time.Now()); !errors.Is(err, cafe.ErrMailMissing) {
		t.Fatalf("missing letter: %v", err)
	}
}

func TestCancellingRefundsTheBatch(t *testing.T) {
	app, owner, stove := newKitchen(t)
	pao := recipe(t, "coxinha")
	setLevel(t, app, owner, pao.Level)
	setGold(t, app, owner, 1000)
	t0 := types.NowDateTime()
	// During preparation the whole cost comes back.
	if err := startCooking(app, owner, stove, pao.ID, t0); err != nil {
		t.Fatal(err)
	}
	if got := gold(t, app, owner); got != 1000-pao.CostCoins {
		t.Fatalf("after starting: %d", got)
	}
	if err := cancelCooking(app, owner, stove, t0.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if got := gold(t, app, owner); got != 1000 {
		t.Fatalf("cancelled while preparing: %d, want 1000", got)
	}
	// While it cooks, the configured share.
	if err := startCooking(app, owner, stove, pao.ID, t0); err != nil {
		t.Fatal(err)
	}
	snapshot, _ := snapshotCooking(app, owner, t0)
	if snapshot.Stoves[0].Cooking == nil || snapshot.Stoves[0].Cooking.CostCoins != pao.CostCoins {
		t.Fatalf("the snapshot does not report the cost: %+v", snapshot.Stoves[0].Cooking)
	}
	if err := cancelCooking(app, owner, stove, t0.Add(gamerules.PrepareDuration()+time.Second)); err != nil {
		t.Fatal(err)
	}
	if got, want := gold(t, app, owner), 1000-pao.CostCoins+gamerules.CancelRefund(pao.CostCoins, false); got != want || want == 1000-pao.CostCoins {
		t.Fatalf("cancelled while cooking: %d, want %d (a partial refund)", got, want)
	}
	// The emergency help was free: nothing to refund.
	setGold(t, app, owner, 0)
	free, _ := gamerules.CheapestRecipe(pao.Level)
	if err := startCooking(app, owner, stove, free.ID, t0); err != nil {
		t.Fatal(err)
	}
	if err := cancelCooking(app, owner, stove, t0.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if got := gold(t, app, owner); got != 0 {
		t.Fatalf("cancelled emergency batch refunded %d", got)
	}
}

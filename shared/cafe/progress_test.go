package cafe

import (
	"errors"
	"testing"
	"time"

	"coffe-mania/shared/gamerules"
)

// newCafe opens a starter café in memory and returns it with its stove.
func newCafe(t *testing.T, owner string) (*MemoryStore, string) {
	t.Helper()
	s := NewMemoryStore()
	if _, err := GetOrCreatePlayer(s, owner); err != nil {
		t.Fatal(err)
	}
	if err := EnsureRoom(s, owner); err != nil {
		t.Fatal(err)
	}
	if err := EnsureStarterStove(s, owner); err != nil {
		t.Fatal(err)
	}
	stove, err := s.First("player_stoves", Where{"user": owner})
	if err != nil {
		t.Fatal(err)
	}
	return s, stove.ID()
}

func playerXP(t *testing.T, s Store, user string) int64 {
	t.Helper()
	state, err := GetOrCreatePlayer(s, user)
	if err != nil {
		t.Fatal(err)
	}
	return state.GetInt64("experience_current")
}

func progressOf(t *testing.T, s Store, user string, now time.Time) ProgressSnapshot {
	t.Helper()
	snapshot, err := SnapshotProgress(s, user, now)
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func achievement(t *testing.T, p ProgressSnapshot, id string) AchievementView {
	t.Helper()
	for _, a := range p.Achievements {
		if a.ID == id {
			return a
		}
	}
	t.Fatalf("no achievement %s", id)
	return AchievementView{}
}

// Noon in São Paulo, far from midnight.
var progressT0 = time.Date(2026, 10, 15, 15, 0, 0, 0, time.UTC)

func TestOwnerSeasoningXPWaitsForTheCounter(t *testing.T) {
	s, stove := newCafe(t, "owner")
	pao, _ := gamerules.RecipeByID("pao_de_queijo")
	xp := gamerules.Stove().SeasonXP
	if xp <= 0 {
		t.Skip("seasoning gives no XP")
	}
	if err := StartCooking(s, "owner", stove, pao.ID, progressT0); err != nil {
		t.Fatal(err)
	}
	before := playerXP(t, s, "owner")
	if err := SeasonCooking(s, "owner", "owner", stove, 0, progressT0.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if got := playerXP(t, s, "owner"); got != before {
		t.Fatalf("seasoning credited %d XP at once", got-before)
	}
	ready := progressT0.Add(gamerules.PrepareDuration() + pao.CookDuration())
	got, err := ServeCookingXP(s, "owner", stove, ready)
	if err != nil || got != xp {
		t.Fatalf("serve = %d XP, %v; want %d", got, err, xp)
	}
	if after := playerXP(t, s, "owner"); after != before+xp {
		t.Fatalf("XP after serving = %d, want %d", after, before+xp)
	}
	p := progressOf(t, s, "owner", ready)
	if a := achievement(t, p, "served_dishes"); a.Progress != 1 {
		t.Fatalf("served dishes = %d", a.Progress)
	}
}

// The loop the owner closed: season, cancel during preparation (full refund), repeat.
func TestSeasonThenCancelEarnsNothing(t *testing.T) {
	s, stove := newCafe(t, "owner")
	pao, _ := gamerules.RecipeByID("pao_de_queijo")
	before := playerXP(t, s, "owner")
	for i := range 3 {
		at := progressT0.Add(time.Duration(i) * time.Minute)
		if err := StartCooking(s, "owner", stove, pao.ID, at); err != nil {
			t.Fatal(err)
		}
		if err := SeasonCooking(s, "owner", "owner", stove, 0, at.Add(500*time.Millisecond)); err != nil {
			t.Fatal(err)
		}
		if refund, err := CancelCooking(s, "owner", stove, at.Add(time.Second)); err != nil || refund != pao.CostCoins {
			t.Fatalf("refund = %d, %v", refund, err)
		}
	}
	if got := playerXP(t, s, "owner"); got != before {
		t.Fatalf("the loop earned %d XP", got-before)
	}
	p := progressOf(t, s, "owner", progressT0.Add(time.Hour))
	if a := achievement(t, p, "spent_coins"); a.Progress != 0 {
		t.Fatalf("spent coins after full refunds = %d", a.Progress)
	}
	for _, m := range p.Missions {
		for _, g := range m.Goals {
			if g.Progress != 0 {
				t.Fatalf("mission %s counted %s = %d", m.ID, g.Stat, g.Progress)
			}
		}
	}
}

func TestVisitorSeasoningPaysAtOnce(t *testing.T) {
	s, stove := newCafe(t, "owner")
	if _, err := GetOrCreatePlayer(s, "friend"); err != nil {
		t.Fatal(err)
	}
	if err := StartCooking(s, "owner", stove, "pao_de_queijo", progressT0); err != nil {
		t.Fatal(err)
	}
	before := playerXP(t, s, "friend")
	if err := SeasonCooking(s, "owner", "friend", stove, 0, progressT0.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if got := playerXP(t, s, "friend"); got != before+gamerules.Stove().SeasonXP {
		t.Fatalf("visitor XP = %d, want +%d", got-before, gamerules.Stove().SeasonXP)
	}
	pao, _ := gamerules.RecipeByID("pao_de_queijo")
	ownerXP := playerXP(t, s, "owner")
	if xp, err := ServeCookingXP(s, "owner", stove, progressT0.Add(gamerules.PrepareDuration()+pao.CookDuration())); err != nil || xp != 0 {
		t.Fatalf("serving a visitor's seasoning paid the owner %d XP (%v)", xp, err)
	}
	if playerXP(t, s, "owner") != ownerXP {
		t.Fatal("the owner earned the visitor's seasoning")
	}
	stats, err := s.First(StatsCollection, Where{"user": "friend"})
	if err != nil || readStats(stats).counts[gamerules.StatSeasoned] != 1 {
		t.Fatalf("visitor seasoning not counted (%v)", err)
	}
}

func TestDailyCountersRollAtSaoPauloMidnight(t *testing.T) {
	s := NewMemoryStore()
	// 23:30 and 00:30 in São Paulo (UTC−3).
	late := time.Date(2026, 10, 16, 2, 30, 0, 0, time.UTC)
	next := late.Add(time.Hour)
	for _, at := range []time.Time{late, late, next} {
		if err := s.Transaction(func(tx Store) error { return count(tx, "p", at, gamerules.StatCustomers, 1) }); err != nil {
			t.Fatal(err)
		}
	}
	// A meal replayed from before the counters' day counts only for life.
	if err := s.Transaction(func(tx Store) error { return count(tx, "p", late, gamerules.StatCustomers, 1) }); err != nil {
		t.Fatal(err)
	}
	stats, _ := s.First(StatsCollection, Where{"user": "p"})
	data := readStats(stats)
	if data.counts[gamerules.StatCustomers] != 4 || data.day != "2026-10-16" || data.dayCounts[gamerules.StatCustomers] != 1 {
		t.Fatalf("counts=%v day=%s dayCounts=%v", data.counts, data.day, data.dayCounts)
	}
	if bonusDate(late) != "2026-10-15" {
		t.Fatalf("23:30 in São Paulo is %s", bonusDate(late))
	}
	// Counters never go below zero.
	if err := s.Transaction(func(tx Store) error { return count(tx, "p", next, gamerules.StatSpentCoins, -50) }); err != nil {
		t.Fatal(err)
	}
	stats, _ = s.First(StatsCollection, Where{"user": "p"})
	if readStats(stats).counts[gamerules.StatSpentCoins] != 0 {
		t.Fatal("negative counter")
	}
}

func TestDailyMissionsAreStablePerPlayerAndDay(t *testing.T) {
	slots := gamerules.MissionSlots()
	a := DailyMissions("player-a", "2026-10-15")
	if len(a) != len(slots) {
		t.Fatalf("%d missions, want %d", len(a), len(slots))
	}
	for i, m := range a {
		found := false
		for _, candidate := range slots[i] {
			found = found || candidate.ID == m.ID
		}
		if !found {
			t.Fatalf("mission %s is not from slot %d", m.ID, i)
		}
	}
	again := DailyMissions("player-a", "2026-10-15")
	for i := range a {
		if a[i].ID != again[i].ID {
			t.Fatal("the draw changed for the same player and day")
		}
	}
	// Over a month the draw is not stuck on one mission per slot.
	seen := map[string]bool{}
	for day := 1; day <= 28; day++ {
		for _, m := range DailyMissions("player-a", time.Date(2026, 2, day, 12, 0, 0, 0, time.UTC).Format(time.DateOnly)) {
			seen[m.ID] = true
		}
	}
	if len(seen) <= len(slots) {
		t.Fatalf("only %d missions in 28 days", len(seen))
	}
}

func TestClaimMissionOncePerDay(t *testing.T) {
	s, _ := newCafe(t, "owner")
	missions := DailyMissions("owner", bonusDate(progressT0))
	mission := missions[0]
	if _, err := ClaimMission(s, "owner", mission.ID, progressT0); !errors.Is(err, ErrRewardLocked) {
		t.Fatalf("incomplete claim: %v", err)
	}
	if _, err := ClaimMission(s, "owner", "not_today", progressT0); !errors.Is(err, ErrRewardMissing) {
		t.Fatalf("unknown mission: %v", err)
	}
	goal := mission.Goals[0]
	if err := s.Transaction(func(tx Store) error { return count(tx, "owner", progressT0, goal.Stat, goal.Target) }); err != nil {
		t.Fatal(err)
	}
	p := progressOf(t, s, "owner", progressT0)
	if p.Ready < 1 || !p.Missions[0].Complete || p.Missions[0].Claimed {
		t.Fatalf("progress = %+v", p.Missions[0])
	}
	before, _ := GetOrCreatePlayer(s, "owner")
	cash, gold := before.GetInt64("cash"), before.GetInt64("gold")
	claim, err := ClaimMission(s, "owner", mission.ID, progressT0)
	if err != nil {
		t.Fatal(err)
	}
	// Only the trio pays Grana: the first mission pays coins and XP.
	if claim.State.Cash != cash || claim.State.Gold < gold+mission.Coins || mission.Cash != 0 {
		t.Fatalf("claim paid cash %d→%d, gold %d→%d", cash, claim.State.Cash, gold, claim.State.Gold)
	}
	if !claim.Progress.Missions[0].Claimed || claim.Progress.Ready != p.Ready-1 {
		t.Fatalf("after claim: %+v ready=%d", claim.Progress.Missions[0], claim.Progress.Ready)
	}
	if _, err := ClaimMission(s, "owner", mission.ID, progressT0.Add(time.Minute)); !errors.Is(err, ErrRewardClaimed) {
		t.Fatalf("second claim: %v", err)
	}
	// Tomorrow the counters start over.
	tomorrow := progressT0.Add(24 * time.Hour)
	for _, m := range progressOf(t, s, "owner", tomorrow).Missions {
		if m.Complete || m.Claimed {
			t.Fatalf("tomorrow's mission %s starts done", m.ID)
		}
	}
}

func TestClaimAchievementTiersInOrder(t *testing.T) {
	s, _ := newCafe(t, "owner")
	customers, _ := gamerules.AchievementByID("customers")
	if _, err := ClaimAchievement(s, "owner", "customers", progressT0); !errors.Is(err, ErrRewardLocked) {
		t.Fatalf("locked claim: %v", err)
	}
	if err := s.Transaction(func(tx Store) error {
		return count(tx, "owner", progressT0, gamerules.StatCustomers, customers.Goals[1].Target)
	}); err != nil {
		t.Fatal(err)
	}
	if a := achievement(t, progressOf(t, s, "owner", progressT0), "customers"); !a.Claimable || a.Claimed != 0 {
		t.Fatalf("view = %+v", a)
	}
	for tier := range 2 {
		before, _ := GetOrCreatePlayer(s, "owner")
		claim, err := ClaimAchievement(s, "owner", "customers", progressT0)
		if err != nil {
			t.Fatalf("tier %d: %v", tier, err)
		}
		goal := customers.Goals[tier]
		if claim.Reward != goal.Reward || claim.State.Cash != before.GetInt64("cash")+goal.Cash ||
			claim.State.Experience.Current != before.GetFloat("experience_current")+float64(goal.XP) {
			t.Fatalf("tier %d paid %+v, state %+v", tier, claim.Reward, claim.State)
		}
		// Each tier also fills a free surprise crate.
		if !claim.FreeCrate || claim.State.Crates.Current != before.GetFloat("crates_current")+1 {
			t.Fatalf("tier %d crate: %v, crates %+v", tier, claim.FreeCrate, claim.State.Crates)
		}
	}
	if _, err := ClaimAchievement(s, "owner", "customers", progressT0); !errors.Is(err, ErrRewardLocked) {
		t.Fatalf("third tier without progress: %v", err)
	}
	// The social achievements are visible since the neighbours (Sprint 16): locked without help given.
	if _, err := ClaimAchievement(s, "owner", "amount_neighbors", progressT0); !errors.Is(err, ErrRewardLocked) {
		t.Fatalf("social achievement: %v", err)
	}
}

func TestDerivedAchievementsReadTheCafe(t *testing.T) {
	s, _ := newCafe(t, "owner")
	state, _ := GetOrCreatePlayer(s, "owner")
	state.Set("cash", 100)
	if err := s.Save(state); err != nil {
		t.Fatal(err)
	}
	if _, err := ExpandRoom(s, "owner", 10, "cash", progressT0); err != nil {
		t.Fatal(err)
	}
	if err := HireStaff(s, "owner", "vostu", "", progressT0); err != nil {
		t.Fatal(err)
	}
	p := progressOf(t, s, "owner", progressT0)
	if a := achievement(t, p, "expansions"); a.Progress != 1 || !a.Claimable {
		t.Fatalf("expansions = %+v", a)
	}
	if a := achievement(t, p, "staff"); a.Progress != 1 || !a.Claimable {
		t.Fatalf("staff = %+v", a)
	}
	// Dismissing and hiring again opens no new slot.
	staff, _ := SnapshotStaff(s, "owner")
	if err := DismissStaff(s, "owner", staff.Staff[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := HireStaff(s, "owner", "vostu", "", progressT0); err != nil {
		t.Fatal(err)
	}
	if a := achievement(t, progressOf(t, s, "owner", progressT0), "staff"); a.Progress != 1 {
		t.Fatalf("rehiring counted: %d", a.Progress)
	}
	unique := achievement(t, p, "unique_dishes")
	for _, goal := range unique.Goals {
		if goal.Target > int64(len(gamerules.Recipes())) {
			t.Fatalf("unreachable tier %d shown", goal.Target)
		}
	}
}

func TestCleanCafeName(t *testing.T) {
	for in, want := range map[string]string{"  Café   da Ana ": "Café da Ana", "Bar & Cia!": "Bar & Cia!", "Quiosque 24h": "Quiosque 24h", "Cafe\u0301 Ana": "Cafe\u0301 Ana"} {
		if got, err := CleanCafeName(in); err != nil || got != want {
			t.Errorf("%q → %q, %v", in, got, err)
		}
	}
	for _, in := range []string{"", "ab", "<b>oi</b>", "café​mania", "um nome comprido demais para caber"} {
		if _, err := CleanCafeName(in); !errors.Is(err, ErrCafeName) {
			t.Errorf("%q accepted", in)
		}
	}
}

func TestTheLastMissionOfTheDayPaysTheTrioGrana(t *testing.T) {
	s, _ := newCafe(t, "owner")
	missions := DailyMissions("owner", bonusDate(progressT0))
	if err := s.Transaction(func(tx Store) error {
		for _, m := range missions {
			for _, goal := range m.Goals {
				if err := count(tx, "owner", progressT0, goal.Stat, goal.Target); err != nil {
					return err
				}
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	trio := gamerules.MissionTrioCash()
	if trio != 1 {
		t.Fatalf("trio cash = %d, want 1", trio)
	}
	for i, m := range missions {
		before, _ := GetOrCreatePlayer(s, "owner")
		claim, err := ClaimMission(s, "owner", m.ID, progressT0)
		if err != nil {
			t.Fatal(err)
		}
		want := int64(0)
		if i == len(missions)-1 {
			want = trio
		}
		if got := claim.State.Cash - before.GetInt64("cash"); got != want || claim.Reward.Cash != want {
			t.Fatalf("mission %d paid %d Grana, want %d", i+1, got, want)
		}
		if claim.Progress.TrioClaimed != (i == len(missions)-1) {
			t.Fatalf("trioClaimed after %d = %v", i+1, claim.Progress.TrioClaimed)
		}
	}
}

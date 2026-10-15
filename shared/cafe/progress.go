package cafe

import (
	"errors"
	"hash/fnv"
	"slices"
	"time"

	"coffe-mania/shared/gamerules"
)

// StatsCollection keeps each player's counters for achievements and daily
// missions. Counters grow inside the game transactions that already exist
// (serving, paying, cleaning, harvesting), never per tick. Fields:
//   - counts: lifetime counters (stat → value);
//   - recipes: recipe ids that reached a counter (unique_dishes);
//   - day, day_counts, day_claimed: the São Paulo date the daily counters
//     belong to, those counters and the missions claimed that date;
//   - achievements: tiers already claimed per achievement.
const StatsCollection = "player_stats"

var ErrRewardMissing = errors.New("Conquista ou missão não encontrada.")
var ErrRewardClaimed = errors.New("Este prêmio já foi resgatado.")
var ErrRewardLocked = errors.New("Complete a meta antes de resgatar.")

// statsRecord finds the player's counters or creates them, inside tx.
func statsRecord(tx Store, user string) (Record, error) {
	record, err := tx.First(StatsCollection, Where{"user": user})
	if err == nil || !errors.Is(err, ErrNotFound) {
		return record, err
	}
	if record, err = tx.New(StatsCollection); err != nil {
		return nil, err
	}
	setAll(record, map[string]any{
		"user": user, "counts": map[string]int64{}, "recipes": []string{},
		"day": "", "day_counts": map[string]int64{}, "day_claimed": []string{}, "achievements": map[string]int{},
	})
	return record, nil
}

type statsData struct {
	counts      map[string]int64
	recipes     []string
	day         string
	dayCounts   map[string]int64
	dayClaimed  []string
	achievement map[string]int
}

func readStats(record Record) statsData {
	data := statsData{counts: map[string]int64{}, dayCounts: map[string]int64{}, achievement: map[string]int{}, day: record.GetString("day")}
	// A field that does not parse counts as empty: counters never block a game transaction.
	_ = record.UnmarshalJSONField("counts", &data.counts)
	_ = record.UnmarshalJSONField("recipes", &data.recipes)
	_ = record.UnmarshalJSONField("day_counts", &data.dayCounts)
	_ = record.UnmarshalJSONField("day_claimed", &data.dayClaimed)
	_ = record.UnmarshalJSONField("achievements", &data.achievement)
	for _, m := range []*map[string]int64{&data.counts, &data.dayCounts} {
		if *m == nil {
			*m = map[string]int64{}
		}
	}
	if data.achievement == nil {
		data.achievement = map[string]int{}
	}
	if data.recipes == nil {
		data.recipes = []string{}
	}
	if data.dayClaimed == nil {
		data.dayClaimed = []string{}
	}
	return data
}

func writeStats(record Record, data statsData) {
	record.Set("counts", data.counts)
	record.Set("recipes", data.recipes)
	record.Set("day", data.day)
	record.Set("day_counts", data.dayCounts)
	record.Set("day_claimed", data.dayClaimed)
	record.Set("achievements", data.achievement)
}

// rollDay moves the daily counters to the given date when it is later than
// theirs; it reports whether the date is the counters' date (an earlier
// instant, such as a meal replayed by the offline catch-up, only counts for life).
func (d *statsData) rollDay(date string) bool {
	if date > d.day {
		d.day, d.dayCounts, d.dayClaimed = date, map[string]int64{}, []string{}
	}
	return date == d.day
}

// statChange is one counter update; recipe also records a recipe served.
type statChange struct {
	stat   string
	delta  int64
	recipe string
}

// countStats applies counter changes inside the caller's transaction, as of
// the instant at (its São Paulo date picks the daily counters). Counters never
// go below zero.
func countStats(tx Store, user string, at time.Time, changes ...statChange) error {
	record, err := statsRecord(tx, user)
	if err != nil {
		return err
	}
	data := readStats(record)
	today := data.rollDay(bonusDate(at))
	for _, change := range changes {
		if change.stat != "" && change.delta != 0 {
			data.counts[change.stat] = max(0, data.counts[change.stat]+change.delta)
			if today && gamerules.DailyStat(change.stat) {
				data.dayCounts[change.stat] = max(0, data.dayCounts[change.stat]+change.delta)
			}
		}
		if change.recipe != "" && !slices.Contains(data.recipes, change.recipe) {
			data.recipes = append(data.recipes, change.recipe)
		}
	}
	writeStats(record, data)
	return tx.Save(record)
}

func count(tx Store, user string, at time.Time, stat string, delta int64) error {
	return countStats(tx, user, at, statChange{stat: stat, delta: delta})
}

type GoalView struct {
	Target int64 `json:"target"`
	gamerules.Reward
}

type AchievementView struct {
	ID          string `json:"id"`
	Code        int    `json:"code,omitempty"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Stat        string `json:"stat"`
	Progress    int64  `json:"progress"`
	// Tiers already claimed; the next goal is Goals[Claimed].
	Claimed int        `json:"claimed"`
	Goals   []GoalView `json:"goals"`
	// The next tier is reached and waits for "Resgatar".
	Claimable bool `json:"claimable"`
}

type MissionGoalView struct {
	Stat     string `json:"stat"`
	Target   int64  `json:"target"`
	Progress int64  `json:"progress"`
}

type MissionView struct {
	ID    string            `json:"id"`
	Title string            `json:"title"`
	Goals []MissionGoalView `json:"goals"`
	gamerules.Reward
	Complete bool `json:"complete"`
	Claimed  bool `json:"claimed"`
}

// ProgressSnapshot is the trophy window: achievements, today's missions and
// how many rewards wait (the badge on the trophy icon).
type ProgressSnapshot struct {
	Achievements []AchievementView `json:"achievements"`
	Missions     []MissionView     `json:"missions"`
	Ready        int               `json:"ready"`
	// Grana paid with the last mission of the day, and whether it was paid today.
	TrioCash    int64 `json:"trioCash"`
	TrioClaimed bool  `json:"trioClaimed"`
	// Today's daily counters (servings paid, coins and tips earned...): the
	// store's "Caixa do dia".
	Today map[string]int64 `json:"today"`
	// Next São Paulo midnight (Unix ms), when the missions change.
	NextAt int64 `json:"nextAt"`
}

// ProgressClaim answers "Resgatar": what it paid, the new window and the HUD.
type ProgressClaim struct {
	Reward      gamerules.Reward `json:"reward"`
	LevelReward int64            `json:"levelReward,omitempty"`
	Progress    ProgressSnapshot `json:"progress"`
	State       PlayerSnapshot   `json:"state"`
}

// derivedStats reads the stats that come from the café itself.
func derivedStats(tx Store, user string, data statsData) (map[string]int64, error) {
	values := map[string]int64{}
	for stat, value := range data.counts {
		values[stat] = value
	}
	values[gamerules.StatUniqueDishes] = int64(len(data.recipes))
	room, err := tx.First("player_rooms", Where{"user": user})
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	if err == nil {
		tiles := max(room.GetInt("tiles_x"), room.GetInt("tiles_y"))
		steps := 0
		for _, step := range gamerules.Expansions().Steps {
			if step.Tiles <= tiles {
				steps++
			}
		}
		values[gamerules.StatExpansions] = int64(steps)
		values[gamerules.StatStaff] = room.GetInt64("staff_slots")
	}
	return values, nil
}

// visibleGoals hides tiers the catalogue cannot reach: unique_dishes goals
// above the number of recipes (the config's 25–100 assume a larger menu).
func visibleGoals(a gamerules.Achievement) []gamerules.AchievementGoal {
	if a.Stat != gamerules.StatUniqueDishes {
		return a.Goals
	}
	limit := int64(len(gamerules.Recipes()))
	goals := []gamerules.AchievementGoal{}
	for _, goal := range a.Goals {
		if goal.Target <= limit {
			goals = append(goals, goal)
		}
	}
	return goals
}

// DailyMissions draws the player's missions for a São Paulo date: one per
// slot, from a hash of the player and the date, so every device and the
// standalone build agree without storing the draw.
func DailyMissions(user, date string) []gamerules.Mission {
	missions := []gamerules.Mission{}
	for slot, pool := range gamerules.MissionSlots() {
		hash := fnv.New32a()
		_, _ = hash.Write([]byte(user + "|" + date + "|" + string(rune('a'+slot))))
		missions = append(missions, pool[int(hash.Sum32()%uint32(len(pool)))])
	}
	return missions
}

func buildProgress(tx Store, user string, record Record, now time.Time) (ProgressSnapshot, error) {
	data := readStats(record)
	values, err := derivedStats(tx, user, data)
	if err != nil {
		return ProgressSnapshot{}, err
	}
	today := bonusDate(now)
	daily := data.rollDay(today)
	snapshot := ProgressSnapshot{Achievements: []AchievementView{}, Missions: []MissionView{}, NextAt: nextMidnight(now).UnixMilli(), TrioCash: gamerules.MissionTrioCash()}
	for _, a := range gamerules.Achievements() {
		goals := visibleGoals(a)
		view := AchievementView{ID: a.ID, Code: a.Code, Name: a.Name, Description: a.Description, Stat: a.Stat,
			Progress: values[a.Stat], Claimed: min(data.achievement[a.ID], len(goals)), Goals: []GoalView{}}
		for _, goal := range goals {
			view.Goals = append(view.Goals, GoalView{Target: goal.Target, Reward: goal.Reward})
		}
		view.Claimable = view.Claimed < len(goals) && view.Progress >= goals[view.Claimed].Target
		if view.Claimable {
			snapshot.Ready++
		}
		snapshot.Achievements = append(snapshot.Achievements, view)
	}
	for _, m := range DailyMissions(user, today) {
		view := MissionView{ID: m.ID, Title: m.Title, Goals: []MissionGoalView{}, Reward: m.Reward,
			Claimed: daily && slices.Contains(data.dayClaimed, m.ID)}
		for _, goal := range m.Goals {
			progress := int64(0)
			if daily {
				progress = min(data.dayCounts[goal.Stat], goal.Target)
			}
			view.Goals = append(view.Goals, MissionGoalView{Stat: goal.Stat, Target: goal.Target, Progress: progress})
			view.Complete = view.Complete || progress >= goal.Target
		}
		if view.Complete && !view.Claimed {
			snapshot.Ready++
		}
		snapshot.Missions = append(snapshot.Missions, view)
	}
	snapshot.Today = map[string]int64{}
	if daily {
		for stat, value := range data.dayCounts {
			snapshot.Today[stat] = value
		}
	}
	snapshot.TrioClaimed = len(snapshot.Missions) > 0 && !slices.ContainsFunc(snapshot.Missions, func(m MissionView) bool { return !m.Claimed })
	return snapshot, nil
}

// SnapshotProgress is the trophy window now. It writes nothing: a player
// without counters sees zeros.
func SnapshotProgress(s Store, user string, now time.Time) (ProgressSnapshot, error) {
	var snapshot ProgressSnapshot
	err := s.Transaction(func(tx Store) error {
		record, err := tx.First(StatsCollection, Where{"user": user})
		if errors.Is(err, ErrNotFound) {
			record, err = statsRecord(tx, user)
		}
		if err != nil {
			return err
		}
		snapshot, err = buildProgress(tx, user, record, now)
		return err
	})
	return snapshot, err
}

// claimReward credits a reward and answers with the new window and HUD; the
// caller already marked the reward as claimed on record.
func claimReward(tx Store, user string, record Record, reward gamerules.Reward, now time.Time) (ProgressClaim, error) {
	state, err := GetOrCreatePlayer(tx, user)
	if err != nil {
		return ProgressClaim{}, err
	}
	progress := Grant(state, reward.Coins, reward.XP)
	state.Set("cash", state.GetInt64("cash")+reward.Cash)
	if err := tx.Save(state); err != nil {
		return ProgressClaim{}, err
	}
	if err := tx.Save(record); err != nil {
		return ProgressClaim{}, err
	}
	snapshot, err := buildProgress(tx, user, record, now)
	if err != nil {
		return ProgressClaim{}, err
	}
	return ProgressClaim{Reward: reward, LevelReward: progress.LevelReward, Progress: snapshot, State: PlayerView(state)}, nil
}

// ClaimAchievement pays the next tier of an achievement once it is reached.
// The tier is checked and recorded in the same transaction as the credit.
func ClaimAchievement(s Store, user, id string, now time.Time) (ProgressClaim, error) {
	achievement, ok := gamerules.AchievementByID(id)
	if !ok {
		return ProgressClaim{}, ErrRewardMissing
	}
	var claim ProgressClaim
	err := s.Transaction(func(tx Store) error {
		record, err := statsRecord(tx, user)
		if err != nil {
			return err
		}
		data := readStats(record)
		values, err := derivedStats(tx, user, data)
		if err != nil {
			return err
		}
		goals := visibleGoals(achievement)
		tier := data.achievement[id]
		if tier >= len(goals) {
			return ErrRewardClaimed
		}
		if values[achievement.Stat] < goals[tier].Target {
			return ErrRewardLocked
		}
		data.achievement[id] = tier + 1
		writeStats(record, data)
		claim, err = claimReward(tx, user, record, goals[tier].Reward, now)
		return err
	})
	return claim, err
}

// ClaimMission pays one of today's missions once it is complete; the last of
// the day's missions also pays the trio's Grana.
func ClaimMission(s Store, user, id string, now time.Time) (ProgressClaim, error) {
	today := bonusDate(now)
	index := slices.IndexFunc(DailyMissions(user, today), func(m gamerules.Mission) bool { return m.ID == id })
	if index < 0 {
		return ProgressClaim{}, ErrRewardMissing
	}
	missions := DailyMissions(user, today)
	mission := missions[index]
	var claim ProgressClaim
	err := s.Transaction(func(tx Store) error {
		record, err := statsRecord(tx, user)
		if err != nil {
			return err
		}
		data := readStats(record)
		if !data.rollDay(today) {
			// Counters dated after today: a clock moved back. Nothing is claimable.
			return ErrRewardLocked
		}
		if slices.Contains(data.dayClaimed, id) {
			return ErrRewardClaimed
		}
		complete := false
		for _, goal := range mission.Goals {
			complete = complete || data.dayCounts[goal.Stat] >= goal.Target
		}
		if !complete {
			return ErrRewardLocked
		}
		data.dayClaimed = append(data.dayClaimed, id)
		writeStats(record, data)
		reward := mission.Reward
		if !slices.ContainsFunc(missions, func(m gamerules.Mission) bool { return !slices.Contains(data.dayClaimed, m.ID) }) {
			reward.Cash += gamerules.MissionTrioCash()
		}
		claim, err = claimReward(tx, user, record, reward, now)
		return err
	})
	return claim, err
}

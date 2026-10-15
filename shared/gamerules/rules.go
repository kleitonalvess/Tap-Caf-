// Package gamerules holds the data-driven game rules shared by persistence and
// the room service. Values are loaded from rules.json and validated at startup;
// gameplay code asks these functions instead of hardcoding numbers.
package gamerules

import (
	"embed"
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"time"
)

//go:embed rules.json
var files embed.FS

type Level struct {
	Level       int   `json:"level"`
	RequiredXP  int64 `json:"requiredXp"`
	RewardCoins int64 `json:"rewardCoins"`
}

// Recipe values are per cooked batch, except the per-serving payment fields.
type Recipe struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Level           int    `json:"level"`
	CostCoins       int64  `json:"costCoins"`
	CookSeconds     int    `json:"cookSeconds"`
	Servings        int    `json:"servings"`
	PricePerServing int64  `json:"pricePerServing"`
	XPPerServing    int64  `json:"xpPerServing"`
	// A ready dish spoils on the stove after this long without being served.
	SpoilSeconds int `json:"spoilSeconds"`
	// Provisional marks design placeholders, not values recovered from the original game.
	Provisional bool `json:"provisional,omitempty"`
}

// StoveRules cover the parts of the stove cycle shared by every recipe.
type StoveRules struct {
	PrepareSeconds int   `json:"prepareSeconds"`
	CleaningCoins  int64 `json:"cleaningCoins"`
	CleaningXP     int64 `json:"cleaningXp"`
	// Seasoning during preparation adds this share of the recipe's servings (rounded up).
	SeasonBonusPercent int   `json:"seasonBonusPercent"`
	SeasonXP           int64 `json:"seasonXp"`
	// Cancelling a batch while it cooks returns this share of what it cost
	// (rounded down); during preparation the whole cost comes back.
	CancelRefundPercent int `json:"cancelRefundPercent"`
}

// DailyRules: the bonus for playing on consecutive days (dates in
// America/Sao_Paulo). Missing a day starts over at day 1, and so does the day
// after the last one.
type DailyRules struct {
	Days        []DailyReward `json:"days"`
	Provisional bool          `json:"provisional,omitempty"`
}

type DailyReward struct {
	Day   int   `json:"day"`
	Coins int64 `json:"coins"`
	Cash  int64 `json:"cash"`
}

// MailRules: letters the café receives. Welcome arrives once per account.
type MailRules struct {
	Welcome Letter `json:"welcome"`
}

type Letter struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	Coins int64  `json:"coins"`
	Cash  int64  `json:"cash"`
}

// Stats the café counts in player_stats (shared/cafe/progress.go). Counted
// stats grow in the transactions that already exist; derived stats are read
// from the café itself, so accounts older than the counters keep their history.
const (
	// Batches moved from the stove to a counter (a cancelled batch never counts).
	StatDishes = "dishes"
	// Distinct recipes among those batches (derived from the recipe list).
	StatUniqueDishes = "unique_dishes"
	// Servings paid by customers, including the offline expediente.
	StatCustomers = "customers"
	// Tables the owner cleared in person.
	StatTables = "tables"
	// Batches seasoned: the owner's count when the dish reaches the counter, a
	// visitor's when seasoning.
	StatSeasoned = "seasoned"
	StatHarvests = "harvests"
	StatParties  = "parties"
	// Coins spent, net of cancel refunds.
	StatSpentCoins = "spent_coins"
	// Expansion steps done and staff slots opened (derived).
	StatExpansions = "expansions"
	StatStaff      = "staff"
	// Social stats wait for neighbours and gifts (Sprint 15).
	StatNeighbors = "neighbors"
	StatGifts     = "gifts"
)

var dailyStats = map[string]bool{StatDishes: true, StatCustomers: true, StatTables: true, StatSeasoned: true, StatHarvests: true, StatParties: true, StatSpentCoins: true}
var achievementStats = map[string]bool{StatDishes: true, StatUniqueDishes: true, StatCustomers: true, StatTables: true, StatSeasoned: true,
	StatHarvests: true, StatParties: true, StatSpentCoins: true, StatExpansions: true, StatStaff: true, StatNeighbors: true, StatGifts: true}

// DailyStat reports whether the stat is also counted per São Paulo day (missions).
func DailyStat(stat string) bool { return dailyStats[stat] }

// Reward is what claiming a goal pays.
type Reward struct {
	Coins int64 `json:"coins"`
	XP    int64 `json:"xp"`
	Cash  int64 `json:"cash"`
}

// AchievementRules: lifetime goals in tiers, each claimed once with
// "Resgatar". Code links the five <achievements> of the config; the others
// are the project's own. Social achievements stay hidden until the stat exists.
type AchievementRules struct {
	List        []Achievement `json:"list"`
	Provisional bool          `json:"provisional,omitempty"`
}

type Achievement struct {
	ID          string            `json:"id"`
	Code        int               `json:"code,omitempty"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Stat        string            `json:"stat"`
	Social      bool              `json:"social,omitempty"`
	Goals       []AchievementGoal `json:"goals"`
}

type AchievementGoal struct {
	Target int64 `json:"target"`
	Reward
}

// MissionRules: three missions a day, one drawn from each slot's pool for the
// player and the São Paulo date, renewed at midnight. TrioCash is the Grana
// paid with the last of the day's missions, for completing them all.
type MissionRules struct {
	Slots       [][]Mission `json:"slots"`
	TrioCash    int64       `json:"trioCash"`
	Provisional bool        `json:"provisional,omitempty"`
}

// Mission is complete when any of its goals is reached that day.
type Mission struct {
	ID    string        `json:"id"`
	Title string        `json:"title"`
	Goals []MissionGoal `json:"goals"`
	Reward
}

type MissionGoal struct {
	Stat   string `json:"stat"`
	Target int64  `json:"target"`
}

// TableRules: every meal leaves its dishes on the table, which stays dirty
// (no customer sits there) until someone clears it.
type TableRules struct {
	CleaningSeconds int   `json:"cleaningSeconds"`
	CleaningXP      int64 `json:"cleaningXp"`
}

type CustomerRules struct {
	// How long a seated customer waits for food before leaving unsatisfied.
	PatienceSeconds int `json:"patienceSeconds"`
	// Arrivals slow down by this factor while food is cooking and no counter has any.
	CookingArrivalFactor float64 `json:"cookingArrivalFactor"`
}

// Frequency applies from Popularity upward. The reference file does not state
// its unit; the room service interprets it as customers per minute.
type Frequency struct {
	Popularity int `json:"popularity"`
	PerMinute  int `json:"perMinute"`
}

type Tip struct {
	Level int   `json:"level"`
	Coins int64 `json:"coins"`
}

// ServiceRules: how a dish reaches the table. A waiter must always beat
// self-service, so customers fetching their own dish take a while and only
// a waiter's delivery earns a tip.
type ServiceRules struct {
	SelfPickupMs     int   `json:"selfPickupMs"`
	WaiterTipPercent int   `json:"waiterTipPercent"`
	WaiterTipMin     int64 `json:"waiterTipMin"`
}

// StreetRules: the buildings across the street. The Farm grows fresh
// ingredients (one charge per harvest, every cooldown) that make the next
// batch pay BonusPercent more coins and XP per serving; the Disco throws a
// party that brings customers ArrivalFactor times as often and multiplies tips.
type StreetRules struct {
	Farm  FarmRules  `json:"farm"`
	Disco DiscoRules `json:"disco"`
}

type FarmRules struct {
	CooldownSeconds int `json:"cooldownSeconds"`
	BonusPercent    int `json:"bonusPercent"`
	MaxCharges      int `json:"maxCharges"`
}

// DiscoRules: CooldownSeconds counts from the end of a party.
type DiscoRules struct {
	DurationSeconds int     `json:"durationSeconds"`
	CooldownSeconds int     `json:"cooldownSeconds"`
	ArrivalFactor   float64 `json:"arrivalFactor"`
	TipMultiplier   int64   `json:"tipMultiplier"`
}

// OfflineRules: the expediente while the café sleeps. After MinAwaySeconds the
// absence (capped at MaxAwaySeconds) is replayed when the room wakes: one meal
// per SeatCycleSeconds per dining seat, at most the arrivals of the café's
// popularity, a waiter delivering one dish per DeliverySeconds.
type OfflineRules struct {
	MinAwaySeconds   int `json:"minAwaySeconds"`
	MaxAwaySeconds   int `json:"maxAwaySeconds"`
	SeatCycleSeconds int `json:"seatCycleSeconds"`
	DeliverySeconds  int `json:"deliverySeconds"`
}

// MaxRoomTiles is the largest room side: the client packs tile indexes as
// ty*20+tx (MAX_NUM_TILES_X in game/src/world/iso.ts).
const MaxRoomTiles = 20

// ExpansionRules: the café grows one step at a time from the starter room.
// Each step is paid with coins once the level is reached, or with cash at any
// level, and pays back RewardCoins plus the step's XP. RewardCoins comes from
// the config's <expansions><newsFeed><rewardCoins>, which rewarded friends'
// clicks on the expansion post; without a news feed it is paid on completion.
type ExpansionRules struct {
	StartTiles  int             `json:"startTiles"`
	RewardCoins int64           `json:"rewardCoins"`
	Steps       []ExpansionStep `json:"steps"`
}

type ExpansionStep struct {
	Tiles int   `json:"tiles"`
	Level int   `json:"level"`
	Coins int64 `json:"coins"`
	Cash  int64 `json:"cash"`
	XP    int64 `json:"xp"`
}

// StaffRules: predefined characters the owner may hire (friends later), the
// one-time fee of each slot (index 0 is the first) and the length of the
// staff actions in the room.
type StaffRules struct {
	HireCoins     []int64        `json:"hireCoins"`
	PickupSeconds int            `json:"pickupSeconds"`
	BusSeconds    int            `json:"busSeconds"`
	Profiles      []StaffProfile `json:"profiles"`
}

type StaffProfile struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Role suggested when hiring; the owner may switch it at any time.
	Role    string `json:"role"`
	Tagline string `json:"tagline"`
}

// Staff roles: waiters carry servings from the counters and clear plates;
// cleaners only clear tables.
const (
	RoleWaiter  = "waiter"
	RoleCleaner = "cleaner"
)

func ValidRole(role string) bool { return role == RoleWaiter || role == RoleCleaner }

type EmployeeLock struct {
	Employees int `json:"employees"`
	Level     int `json:"level"`
}

// PopularityRules use whole popularity points; storage keeps tenths.
type PopularityRules struct {
	Min              int     `json:"min"`
	Max              int     `json:"max"`
	SatisfiedDelta   float64 `json:"satisfiedDelta"`
	UnsatisfiedDelta float64 `json:"unsatisfiedDelta"`
}

type Rules struct {
	Popularity        PopularityRules  `json:"popularity"`
	Customers         CustomerRules    `json:"customers"`
	Stove             StoveRules       `json:"stove"`
	Tables            TableRules       `json:"tables"`
	Service           ServiceRules     `json:"service"`
	Street            StreetRules      `json:"street"`
	Offline           OfflineRules     `json:"offline"`
	Expansions        ExpansionRules   `json:"expansions"`
	Staff             StaffRules       `json:"staff"`
	Daily             DailyRules       `json:"daily"`
	Mail              MailRules        `json:"mail"`
	Achievements      AchievementRules `json:"achievements"`
	Missions          MissionRules     `json:"missions"`
	Levels            []Level          `json:"levels"`
	CustomerFrequency []Frequency      `json:"customerFrequency"`
	Tips              []Tip            `json:"tips"`
	EmployeeLocks     []EmployeeLock   `json:"employeeLocks"`
	Recipes           []Recipe         `json:"recipes"`
}

// Recipe ids are stored in stove_cooking.recipe_id and room_food.recipe_id (max 40).
var recipeIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)

var rules Rules

func init() {
	data, err := files.ReadFile("rules.json")
	if err != nil {
		panic(err)
	}
	var parsed Rules
	if err := json.Unmarshal(data, &parsed); err != nil {
		panic(err)
	}
	if message := validate(parsed); message != "" {
		panic("invalid game rules: " + message)
	}
	rules = parsed
}

func validate(r Rules) string {
	if len(r.Levels) == 0 || r.Levels[0].Level != 1 || r.Levels[0].RequiredXP != 0 {
		return "levels must start at level 1 with 0 XP"
	}
	for i, level := range r.Levels {
		if level.Level != i+1 || level.RewardCoins < 0 || i > 0 && level.RequiredXP <= r.Levels[i-1].RequiredXP {
			return "levels must be contiguous with increasing XP"
		}
	}
	p := r.Popularity
	if p.Min < 0 || p.Max <= p.Min || p.SatisfiedDelta <= 0 || p.UnsatisfiedDelta <= 0 {
		return "invalid popularity bounds"
	}
	if len(r.CustomerFrequency) == 0 {
		return "missing customer frequency"
	}
	for i, f := range r.CustomerFrequency {
		if f.PerMinute <= 0 || i > 0 && f.Popularity <= r.CustomerFrequency[i-1].Popularity {
			return "customer frequency must increase by popularity"
		}
	}
	for i, t := range r.Tips {
		if t.Coins < 0 || i > 0 && t.Level <= r.Tips[i-1].Level {
			return "tips must increase by level"
		}
	}
	for i, lock := range r.EmployeeLocks {
		if lock.Employees != i+1 || lock.Level < 1 || i > 0 && lock.Level < r.EmployeeLocks[i-1].Level {
			return "employee locks must be contiguous"
		}
	}
	c := r.Customers
	if c.PatienceSeconds < 5 || c.PatienceSeconds > 600 || c.CookingArrivalFactor < 1 || c.CookingArrivalFactor > 5 {
		return "invalid customer rules"
	}
	s := r.Stove
	if s.PrepareSeconds < 0 || s.PrepareSeconds > 60 || s.CleaningCoins < 0 || s.CleaningXP < 0 ||
		s.SeasonBonusPercent < 0 || s.SeasonBonusPercent > 100 || s.SeasonXP < 0 || s.CancelRefundPercent < 0 || s.CancelRefundPercent > 100 {
		return "invalid stove rules"
	}
	if len(r.Daily.Days) == 0 || len(r.Daily.Days) > 31 {
		return "invalid daily bonus"
	}
	for i, day := range r.Daily.Days {
		if day.Day != i+1 || day.Coins < 0 || day.Cash < 0 || day.Coins == 0 && day.Cash == 0 {
			return "daily bonus days must be contiguous and pay something"
		}
	}
	if w := r.Mail.Welcome; w.Title == "" || len(w.Title) > 80 || w.Body == "" || len(w.Body) > 600 || w.Coins < 0 || w.Cash < 0 {
		return "invalid welcome letter"
	}
	if message := validateProgress(r); message != "" {
		return message
	}
	if t := r.Tables; t.CleaningSeconds < 1 || t.CleaningSeconds > 30 || t.CleaningXP < 0 {
		return "invalid table rules"
	}
	if v := r.Service; v.SelfPickupMs < 0 || v.SelfPickupMs > 30000 || v.WaiterTipPercent < 0 || v.WaiterTipPercent > 100 || v.WaiterTipMin < 0 {
		return "invalid service rules"
	}
	if o := r.Offline; o.MinAwaySeconds < 30 || o.MaxAwaySeconds < o.MinAwaySeconds || o.MaxAwaySeconds > 7*24*3600 ||
		o.SeatCycleSeconds < 5 || o.SeatCycleSeconds > 600 || o.DeliverySeconds < 1 || o.DeliverySeconds > 600 {
		return "invalid offline rules"
	}
	if f := r.Street.Farm; f.CooldownSeconds < 60 || f.CooldownSeconds > 86400 || f.BonusPercent < 1 || f.BonusPercent > 100 || f.MaxCharges < 1 || f.MaxCharges > 10 {
		return "invalid farm rules"
	}
	if d := r.Street.Disco; d.DurationSeconds < 30 || d.DurationSeconds > 3600 || d.CooldownSeconds < 0 || d.CooldownSeconds > 86400 ||
		d.ArrivalFactor < 1 || d.ArrivalFactor > 5 || d.TipMultiplier < 1 || d.TipMultiplier > 10 {
		return "invalid disco rules"
	}
	e := r.Expansions
	if e.StartTiles < 2 || e.StartTiles > MaxRoomTiles || e.RewardCoins < 0 {
		return "invalid starter room"
	}
	for i, step := range e.Steps {
		previous := ExpansionStep{Tiles: e.StartTiles, Level: 1}
		if i > 0 {
			previous = e.Steps[i-1]
		}
		if step.Tiles <= previous.Tiles || step.Tiles > MaxRoomTiles || step.Level < previous.Level || step.Level > len(r.Levels) ||
			step.Coins <= 0 || step.Cash <= 0 || step.XP < 0 {
			return "expansions must grow up to the room limit"
		}
	}
	if len(r.Staff.HireCoins) != len(r.EmployeeLocks) {
		return "every employee slot needs a hiring fee"
	}
	for i, fee := range r.Staff.HireCoins {
		if fee < 0 || i > 0 && fee < r.Staff.HireCoins[i-1] {
			return "hiring fees must not decrease"
		}
	}
	if s := r.Staff; s.PickupSeconds < 1 || s.PickupSeconds > 30 || s.BusSeconds < 1 || s.BusSeconds > 30 ||
		len(s.Profiles) < len(r.EmployeeLocks) {
		return "invalid staff rules"
	}
	profiles := map[string]bool{}
	for _, p := range r.Staff.Profiles {
		if !recipeIDPattern.MatchString(p.ID) || profiles[p.ID] || p.Name == "" || len(p.Name) > 60 || !ValidRole(p.Role) {
			return "invalid staff profile " + p.ID
		}
		profiles[p.ID] = true
	}
	const week = 7 * 24 * 60 * 60
	seen := map[string]bool{}
	for _, recipe := range r.Recipes {
		if !recipeIDPattern.MatchString(recipe.ID) || seen[recipe.ID] || recipe.Name == "" ||
			recipe.Level < 1 || recipe.Level > len(r.Levels) || recipe.CostCoins < 0 ||
			recipe.CookSeconds < 1 || recipe.CookSeconds > week || recipe.Servings < 1 || recipe.Servings > 100 ||
			recipe.PricePerServing < 0 || recipe.XPPerServing < 0 || recipe.SpoilSeconds < 30 || recipe.SpoilSeconds > week {
			return "invalid recipe " + recipe.ID
		}
		seen[recipe.ID] = true
	}
	if len(seen) == 0 {
		return "missing recipes"
	}
	return ""
}

func validReward(r Reward) bool {
	return r.Coins >= 0 && r.XP >= 0 && r.Cash >= 0 && r.Coins+r.XP+r.Cash > 0
}

func validateProgress(r Rules) string {
	ids := map[string]bool{}
	for _, a := range r.Achievements.List {
		if !recipeIDPattern.MatchString(a.ID) || ids[a.ID] || a.Name == "" || len(a.Name) > 60 || len(a.Description) > 200 ||
			!achievementStats[a.Stat] || len(a.Goals) == 0 || len(a.Goals) > 10 {
			return "invalid achievement " + a.ID
		}
		ids[a.ID] = true
		for i, goal := range a.Goals {
			if goal.Target < 1 || i > 0 && goal.Target <= a.Goals[i-1].Target || !validReward(goal.Reward) {
				return "achievement goals must grow and pay something: " + a.ID
			}
		}
	}
	if len(r.Missions.Slots) == 0 || len(r.Missions.Slots) > 5 || r.Missions.TrioCash < 0 || r.Missions.TrioCash > 10 {
		return "invalid missions"
	}
	ids = map[string]bool{}
	for _, pool := range r.Missions.Slots {
		if len(pool) == 0 {
			return "every mission slot needs a pool"
		}
		for _, m := range pool {
			if !recipeIDPattern.MatchString(m.ID) || ids[m.ID] || m.Title == "" || len(m.Title) > 80 || len(m.Goals) == 0 || len(m.Goals) > 3 || !validReward(m.Reward) {
				return "invalid mission " + m.ID
			}
			ids[m.ID] = true
			for _, goal := range m.Goals {
				if !dailyStats[goal.Stat] || goal.Target < 1 {
					return "invalid mission goal " + m.ID
				}
			}
		}
	}
	return ""
}

func RecipeByID(id string) (Recipe, bool) {
	for _, recipe := range rules.Recipes {
		if recipe.ID == id {
			return recipe, true
		}
	}
	return Recipe{}, false
}

func (r Recipe) CookDuration() time.Duration {
	return time.Duration(r.CookSeconds) * time.Second
}

func (r Recipe) SpoilDuration() time.Duration {
	return time.Duration(r.SpoilSeconds) * time.Second
}

// Recipes returns the catalogue in book order.
func Recipes() []Recipe { return append([]Recipe{}, rules.Recipes...) }

// CheapestRecipe is the recipe the emergency help gives away: the lowest cost
// unlocked at this level, then the shortest, then the id for a stable answer.
func CheapestRecipe(level int) (Recipe, bool) {
	unlocked := []Recipe{}
	for _, recipe := range rules.Recipes {
		if recipe.Level <= level {
			unlocked = append(unlocked, recipe)
		}
	}
	if len(unlocked) == 0 {
		return Recipe{}, false
	}
	sort.SliceStable(unlocked, func(i, j int) bool {
		a, b := unlocked[i], unlocked[j]
		if a.CostCoins != b.CostCoins {
			return a.CostCoins < b.CostCoins
		}
		if a.CookSeconds != b.CookSeconds {
			return a.CookSeconds < b.CookSeconds
		}
		return a.ID < b.ID
	})
	return unlocked[0], true
}

func Stove() StoveRules { return rules.Stove }

// CancelRefund is what cancelling a batch that cost this much returns.
func CancelRefund(cost int64, preparing bool) int64 {
	if cost <= 0 {
		return 0
	}
	if preparing {
		return cost
	}
	return cost * int64(rules.Stove.CancelRefundPercent) / 100
}

func Daily() DailyRules {
	d := rules.Daily
	d.Days = append([]DailyReward{}, d.Days...)
	return d
}

// DailyRewardFor is the reward of a day of the streak (1 is the first).
func DailyRewardFor(day int) DailyReward {
	days := rules.Daily.Days
	return days[min(max(day, 1), len(days))-1]
}

func Mail() MailRules { return rules.Mail }

// Achievements returns the visible achievements: social ones wait for their stat.
func Achievements() []Achievement {
	list := []Achievement{}
	for _, a := range rules.Achievements.List {
		if !a.Social {
			a.Goals = append([]AchievementGoal{}, a.Goals...)
			list = append(list, a)
		}
	}
	return list
}

func AchievementByID(id string) (Achievement, bool) {
	for _, a := range Achievements() {
		if a.ID == id {
			return a, true
		}
	}
	return Achievement{}, false
}

// MissionTrioCash is the Grana for claiming every mission of a day.
func MissionTrioCash() int64 { return rules.Missions.TrioCash }

// MissionSlots returns each slot's pool.
func MissionSlots() [][]Mission {
	slots := make([][]Mission, len(rules.Missions.Slots))
	for i, pool := range rules.Missions.Slots {
		slots[i] = append([]Mission{}, pool...)
	}
	return slots
}

func PrepareDuration() time.Duration { return time.Duration(rules.Stove.PrepareSeconds) * time.Second }

// SeasonBonus is the extra servings a seasoned batch yields; at least one when enabled.
func SeasonBonus(servings int) int {
	if rules.Stove.SeasonBonusPercent == 0 {
		return 0
	}
	return max(1, (servings*rules.Stove.SeasonBonusPercent+99)/100)
}

func CustomerPatience() time.Duration {
	return time.Duration(rules.Customers.PatienceSeconds) * time.Second
}

func CookingArrivalFactor() float64 { return rules.Customers.CookingArrivalFactor }

func Tables() TableRules { return rules.Tables }

func Staff() StaffRules { return rules.Staff }

func StaffProfileByID(id string) (StaffProfile, bool) {
	for _, p := range rules.Staff.Profiles {
		if p.ID == id {
			return p, true
		}
	}
	return StaffProfile{}, false
}

// EmployeeSlots is how many staff members a café of this level may keep.
func EmployeeSlots(level int) int {
	slots := 0
	for _, lock := range rules.EmployeeLocks {
		if level >= lock.Level {
			slots = lock.Employees
		}
	}
	return slots
}

// NextEmployeeSlotLevel is the level that opens one more slot (false at the cap).
func NextEmployeeSlotLevel(level int) (int, bool) {
	for _, lock := range rules.EmployeeLocks {
		if lock.Level > level {
			return lock.Level, true
		}
	}
	return 0, false
}

// HireCost is the one-time fee to open the given slot (1 is the first);
// slots beyond the table cost like the last one.
func HireCost(slot int) int64 {
	fees := rules.Staff.HireCoins
	if slot < 1 || len(fees) == 0 {
		return 0
	}
	return fees[min(slot, len(fees))-1]
}

func Expansions() ExpansionRules {
	e := rules.Expansions
	e.Steps = append([]ExpansionStep{}, e.Steps...)
	return e
}

// NextExpansion is the step after a room of the given side (false at the cap).
func NextExpansion(tiles int) (ExpansionStep, bool) {
	for _, step := range rules.Expansions.Steps {
		if step.Tiles > tiles {
			return step, true
		}
	}
	return ExpansionStep{}, false
}

func Street() StreetRules { return rules.Street }

func Offline() OfflineRules { return rules.Offline }

func FarmCooldown() time.Duration {
	return time.Duration(rules.Street.Farm.CooldownSeconds) * time.Second
}

func PartyDuration() time.Duration {
	return time.Duration(rules.Street.Disco.DurationSeconds) * time.Second
}

func PartyCooldown() time.Duration {
	return time.Duration(rules.Street.Disco.CooldownSeconds) * time.Second
}

// FreshBonus is the extra a fresh-ingredient serving adds to a value
// (coins or XP), rounded up so every fresh serving earns at least one more.
func FreshBonus(value int64) int64 {
	if value <= 0 {
		return 0
	}
	return (value*int64(rules.Street.Farm.BonusPercent) + 99) / 100
}

// SelfPickup is how long a customer takes to fetch a dish from the counter.
func SelfPickup() time.Duration { return time.Duration(rules.Service.SelfPickupMs) * time.Millisecond }

// WaiterTip is what a customer adds for a dish worth coins brought to the table.
func WaiterTip(coins int64) int64 {
	return max(rules.Service.WaiterTipMin, coins*int64(rules.Service.WaiterTipPercent)/100)
}

func PickupDuration() time.Duration { return time.Duration(rules.Staff.PickupSeconds) * time.Second }

func BusDuration() time.Duration { return time.Duration(rules.Staff.BusSeconds) * time.Second }

// TableCleaning is how long clearing a dirty table animates.
func TableCleaning() time.Duration { return time.Duration(rules.Tables.CleaningSeconds) * time.Second }

// Public is the whole rule set for clients; none of it is secret.
func Public() Rules {
	snapshot := rules
	snapshot.Levels = append([]Level{}, rules.Levels...)
	snapshot.Recipes = Recipes()
	snapshot.Staff.Profiles = append([]StaffProfile{}, rules.Staff.Profiles...)
	snapshot.Staff.HireCoins = append([]int64{}, rules.Staff.HireCoins...)
	snapshot.Expansions = Expansions()
	snapshot.Daily = Daily()
	snapshot.Achievements.List = append([]Achievement{}, rules.Achievements.List...)
	snapshot.Missions.Slots = MissionSlots()
	return snapshot
}

func MaxLevel() int { return len(rules.Levels) }

// LevelForXP returns the highest level whose requirement is met by total XP.
func LevelForXP(xp int64) int {
	level := 1
	for _, l := range rules.Levels {
		if xp < l.RequiredXP {
			break
		}
		level = l.Level
	}
	return level
}

// NextLevelXP is the total XP that reaches level+1; the last level returns its own requirement.
func NextLevelXP(level int) int64 {
	if level < 1 {
		level = 1
	}
	if level >= len(rules.Levels) {
		return rules.Levels[len(rules.Levels)-1].RequiredXP
	}
	return rules.Levels[level].RequiredXP
}

// LevelRewards sums the coins granted for every level after from, up to and including to.
func LevelRewards(from, to int) int64 {
	var total int64
	for _, l := range rules.Levels {
		if l.Level > from && l.Level <= to {
			total += l.RewardCoins
		}
	}
	return total
}

// PopularityBoundsTenths matches player_state.satisfaction_*_tenths.
func PopularityBoundsTenths() (int, int) {
	return rules.Popularity.Min * 10, rules.Popularity.Max * 10
}

// ApplyCustomer returns the popularity, in tenths, after one customer's verdict.
func ApplyCustomer(tenths int, satisfied bool) int {
	low, high := PopularityBoundsTenths()
	if satisfied {
		tenths += int(math.Round(rules.Popularity.SatisfiedDelta * 10))
	} else {
		tenths -= int(math.Round(rules.Popularity.UnsatisfiedDelta * 10))
	}
	return min(high, max(low, tenths))
}

// CustomersPerMinute uses the highest frequency band reached by the popularity.
func CustomersPerMinute(tenths int) int {
	perMinute := rules.CustomerFrequency[0].PerMinute
	for _, f := range rules.CustomerFrequency {
		if tenths < f.Popularity*10 {
			break
		}
		perMinute = f.PerMinute
	}
	return perMinute
}

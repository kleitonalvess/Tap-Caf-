package cafe

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"math/big"
	"strconv"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/roomcatalog"
)

// CrateOpenings remembers each crate opening by its request key: repeating a
// request (a retry after a lost answer) returns the same prize instead of
// charging and drawing again.
const CrateOpenings = "crate_openings"

var ErrSpiceUnknown = errors.New("Tempero desconhecido.")
var ErrSpiceCoins = errors.New("Moedas insuficientes para este tempero.")
var ErrSpiceEmpty = errors.New("Você não tem esse tempero na despensa.")
var ErrSpiceOwner = errors.New("Só o dono do café usa os temperos da despensa.")
var ErrCrateUnknown = errors.New("Caixa desconhecida.")
var ErrCrateEmpty = errors.New("Você não tem caixas surpresa para abrir.")
var ErrCrateCoins = errors.New("Moedas insuficientes para esta caixa.")
var ErrCrateCash = errors.New("Grana insuficiente para esta caixa.")
var ErrCrateRequest = errors.New("Pedido de abertura inválido.")
var ErrSpiceFull = errors.New("A despensa já está cheia deste tempero. Uma Prateleira de Temperos no café guarda mais.")
var ErrPantryCash = errors.New("Grana insuficiente para este item.")
var ErrPantryEmpty = errors.New("Você não tem este item na despensa.")
var ErrPantryUse = errors.New("Este item é usado nas máquinas, não direto da despensa.")

// RandomIntn draws a number in [0, n) for crates and random spices; crypto/rand
// in the game. Tests replace it to play the same draws on both stores.
var RandomIntn = func(n int) int {
	value, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		return 0
	}
	return int(value.Int64())
}

// The pantry lives in player_state.pantry as {"800001": 2, ...}.
func readPantry(state Record) map[int]int {
	// Decoded entry by entry: one bad value (an edited save) must not empty the
	// whole pantry, which the next write would then persist.
	raw := map[string]json.RawMessage{}
	_ = state.UnmarshalJSONField("pantry", &raw)
	pantry := map[int]int{}
	for key, value := range raw {
		var count float64
		if code, err := strconv.Atoi(key); err == nil && json.Unmarshal(value, &count) == nil && count >= 1 && count <= 1e6 {
			pantry[code] = int(count)
		}
	}
	return pantry
}

func writePantry(state Record, pantry map[int]int) {
	raw := map[string]int{}
	for code, count := range pantry {
		if count > 0 {
			raw[strconv.Itoa(code)] = count
		}
	}
	state.Set("pantry", raw)
}

func addSpices(state Record, code, count int) {
	pantry := readPantry(state)
	pantry[code] += count
	writePantry(state, pantry)
}

// randomSpices adds n spices drawn from the random ones of the pantry list
// (the config's rewardSpice randomValues).
func randomSpices(state Record, n int) []int {
	spices := []gamerules.Spice{}
	for _, spice := range gamerules.Spices() {
		if spice.Random {
			spices = append(spices, spice)
		}
	}
	drawn := []int{}
	for range n {
		if len(spices) == 0 {
			break
		}
		code := spices[RandomIntn(len(spices))].Code
		addSpices(state, code, 1)
		drawn = append(drawn, code)
	}
	return drawn
}

type SpiceView struct {
	gamerules.Spice
	Count int `json:"count"`
}

type ConsumableView struct {
	gamerules.Consumable
	Count int `json:"count"`
}

// PantrySnapshot is the pantry window and the crates window.
type PantrySnapshot struct {
	Spices []SpiceView `json:"spices"`
	// Energy drinks and machine parts.
	Items []ConsumableView `json:"items"`
	// Charges of each spice the pantry holds (more with a spice shelf placed).
	SpiceLimit int               `json:"spiceLimit"`
	Shelf      bool              `json:"shelf"`
	FreeCrates int               `json:"freeCrates"`
	FreeMax    int               `json:"freeMax"`
	Crates     []gamerules.Crate `json:"crates"`
}

func spiceLimit(shelf bool) int {
	if shelf {
		return gamerules.Pantry().ShelfSpiceLimit
	}
	return gamerules.Pantry().SpiceLimit
}

func pantryView(state Record, shelf bool) PantrySnapshot {
	pantry := readPantry(state)
	rules := gamerules.CrateRulesNow()
	snapshot := PantrySnapshot{Spices: []SpiceView{}, Items: []ConsumableView{}, SpiceLimit: spiceLimit(shelf), Shelf: shelf,
		FreeCrates: state.GetInt("crates_current"), FreeMax: rules.FreeMax, Crates: rules.List}
	for _, spice := range gamerules.Spices() {
		snapshot.Spices = append(snapshot.Spices, SpiceView{Spice: spice, Count: pantry[spice.Code]})
	}
	for _, item := range gamerules.Consumables() {
		snapshot.Items = append(snapshot.Items, ConsumableView{Consumable: item, Count: pantry[item.Code]})
	}
	return snapshot
}

// ownerPantryView reads whether the café has a spice shelf placed.
func ownerPantryView(s Store, user string, state Record) (PantrySnapshot, error) {
	shelf, err := hasPlacedKind(s, user, "shelf")
	if err != nil {
		return PantrySnapshot{}, err
	}
	return pantryView(state, shelf), nil
}

func SnapshotPantry(s Store, user string) (PantrySnapshot, error) {
	state, err := GetOrCreatePlayer(s, user)
	if err != nil {
		return PantrySnapshot{}, err
	}
	return ownerPantryView(s, user, state)
}

// PantryResult answers a purchase: the new pantry and HUD.
type PantryResult struct {
	Pantry PantrySnapshot `json:"pantry"`
	State  PlayerSnapshot `json:"state"`
}

// BuySpice adds one pantry item: a spice for coins (up to the pantry's limit
// per spice), or a consumable for its coin or Grana price.
func BuySpice(s Store, user string, code int, now time.Time) (PantryResult, error) {
	spice, isSpice := gamerules.SpiceByCode(code)
	item, isItem := gamerules.ConsumableByCode(code)
	if !isSpice && !isItem {
		return PantryResult{}, ErrSpiceUnknown
	}
	if _, err := GetOrCreatePlayer(s, user); err != nil {
		return PantryResult{}, err
	}
	var result PantryResult
	err := s.Transaction(func(tx Store) error {
		state, err := tx.First(PlayerCollection, Where{"user": user})
		if err != nil {
			return err
		}
		shelf, err := hasPlacedKind(tx, user, "shelf")
		if err != nil {
			return err
		}
		coins, cash := spice.PriceCoins, int64(0)
		if isItem {
			coins, cash = item.PriceCoins, item.PriceCash
		} else if readPantry(state)[code] >= spiceLimit(shelf) {
			return ErrSpiceFull
		}
		if state.GetInt64("gold") < coins {
			return ErrSpiceCoins
		}
		if state.GetInt64("cash") < cash {
			return ErrPantryCash
		}
		state.Set("gold", state.GetInt64("gold")-coins)
		state.Set("cash", state.GetInt64("cash")-cash)
		addSpices(state, code, 1)
		if err := tx.Save(state); err != nil {
			return err
		}
		if coins > 0 {
			if err := count(tx, user, now, gamerules.StatSpentCoins, coins); err != nil {
				return err
			}
		}
		result = PantryResult{Pantry: pantryView(state, shelf), State: PlayerView(state)}
		return nil
	})
	return result, err
}

// UseConsumable drinks an energy item from the pantry.
func UseConsumable(s Store, user string, code int, now time.Time) (PantryResult, error) {
	item, ok := gamerules.ConsumableByCode(code)
	if !ok {
		return PantryResult{}, ErrSpiceUnknown
	}
	if item.Kind != gamerules.ConsumableEnergy {
		return PantryResult{}, ErrPantryUse
	}
	if _, err := GetOrCreatePlayer(s, user); err != nil {
		return PantryResult{}, err
	}
	var result PantryResult
	err := s.Transaction(func(tx Store) error {
		state, err := tx.First(PlayerCollection, Where{"user": user})
		if err != nil {
			return err
		}
		pantry := readPantry(state)
		if pantry[code] < 1 {
			return ErrPantryEmpty
		}
		if current, _ := energyNow(state, now); current >= gamerules.Energy().Cap {
			return ErrEnergyFull
		}
		pantry[code]--
		writePantry(state, pantry)
		AddEnergy(state, item.Amount, now)
		if err := tx.Save(state); err != nil {
			return err
		}
		result.Pantry, err = ownerPantryView(tx, user, state)
		result.State = PlayerView(state)
		return err
	})
	return result, err
}

// CratePrizeView is a drawn prize with the names the window shows.
type CratePrizeView struct {
	gamerules.CratePrize
	Name string `json:"name"`
	// The inventory unit an item prize became (stored, ready to place).
	UnitID string `json:"unitId,omitempty"`
}

// CrateResult answers an opening: the prize, the new pantry and HUD.
type CrateResult struct {
	Crate       string         `json:"crate"`
	Prize       CratePrizeView `json:"prize"`
	LevelReward int64          `json:"levelReward,omitempty"`
	Pantry      PantrySnapshot `json:"pantry"`
	State       PlayerSnapshot `json:"state"`
}

func drawPrize(crate gamerules.Crate) gamerules.CratePrize {
	total := 0
	for _, prize := range crate.Prizes {
		total += prize.Weight
	}
	roll := RandomIntn(total)
	for _, prize := range crate.Prizes {
		if roll < prize.Weight {
			return prize
		}
		roll -= prize.Weight
	}
	return crate.Prizes[len(crate.Prizes)-1]
}

// PrizeName is how the window names a prize: "300 moedas", "2× Tempero Real"...
func PrizeName(prize gamerules.CratePrize) string {
	switch {
	case prize.Coins > 0:
		return strconv.FormatInt(prize.Coins, 10) + " moedas"
	case prize.Cash > 0:
		return strconv.FormatInt(prize.Cash, 10) + " Grana"
	case prize.Spice > 0:
		spice, _ := gamerules.SpiceByCode(prize.Spice)
		return strconv.Itoa(prize.Count) + "× " + spice.Name
	case prize.Stock > 0:
		item, _ := gamerules.ConsumableByCode(prize.Stock)
		return strconv.Itoa(prize.Count) + "× " + item.Name
	case prize.Item > 0:
		item, _ := roomcatalog.ByID(prize.Item)
		return item.Name
	}
	return ""
}

// OpenCrate pays for a crate (a free one from the HUD, coins or Grana), draws
// one prize and delivers it in the same transaction. The request key makes a
// repeated request answer with the first result.
func OpenCrate(s Store, user, crateID, requestKey string, now time.Time) (CrateResult, error) {
	crate, ok := gamerules.CrateByID(crateID)
	if !ok {
		return CrateResult{}, ErrCrateUnknown
	}
	if !RequestKeyPattern.MatchString(requestKey) {
		return CrateResult{}, ErrCrateRequest
	}
	if _, err := GetOrCreatePlayer(s, user); err != nil {
		return CrateResult{}, err
	}
	result, err := openCrate(s, user, crate, requestKey, now)
	if status, _ := PantryErrorStatus(err); err != nil && status == 500 {
		// Two requests with the same key at once: the loser's insert breaks the
		// unique (user, request_key) index and rolls back. Running it again finds
		// the winner's opening and answers the same prize.
		result, err = openCrate(s, user, crate, requestKey, now)
	}
	return result, err
}

func openCrate(s Store, user string, crate gamerules.Crate, requestKey string, now time.Time) (CrateResult, error) {
	crateID := crate.ID
	var result CrateResult
	err := s.Transaction(func(tx Store) error {
		if opened, err := tx.First(CrateOpenings, Where{"user": user, "request_key": requestKey}); err == nil {
			if opened.GetString("crate") != crateID {
				return ErrCrateRequest
			}
			if err := opened.UnmarshalJSONField("result", &result); err != nil {
				return err
			}
			state, err := tx.First(PlayerCollection, Where{"user": user})
			if err != nil {
				return err
			}
			result.State = PlayerView(state)
			result.Pantry, err = ownerPantryView(tx, user, state)
			return err
		} else if !errors.Is(err, ErrNotFound) {
			return err
		}
		state, err := tx.First(PlayerCollection, Where{"user": user})
		if err != nil {
			return err
		}
		switch {
		case crate.Free:
			if state.GetInt("crates_current") < 1 {
				return ErrCrateEmpty
			}
			state.Set("crates_current", state.GetInt("crates_current")-1)
		case crate.Coins > 0:
			if state.GetInt64("gold") < crate.Coins {
				return ErrCrateCoins
			}
			state.Set("gold", state.GetInt64("gold")-crate.Coins)
			if err := count(tx, user, now, gamerules.StatSpentCoins, crate.Coins); err != nil {
				return err
			}
		default:
			if state.GetInt64("cash") < crate.Cash {
				return ErrCrateCash
			}
			state.Set("cash", state.GetInt64("cash")-crate.Cash)
		}
		prize := drawPrize(crate)
		view := CratePrizeView{CratePrize: prize, Name: PrizeName(prize)}
		switch {
		case prize.Coins > 0:
			result.LevelReward = Grant(state, prize.Coins, 0).LevelReward
		case prize.Cash > 0:
			state.Set("cash", state.GetInt64("cash")+prize.Cash)
		case prize.Spice > 0:
			addSpices(state, prize.Spice, prize.Count)
		case prize.Stock > 0:
			addSpices(state, prize.Stock, prize.Count)
		case prize.Item > 0:
			item, _ := roomcatalog.ByID(prize.Item)
			unit, err := tx.New("player_inventory")
			if err != nil {
				return err
			}
			setAll(unit, map[string]any{"user": user, "item_id": item.ID, "layer": roomcatalog.Layer(item), "placed": false})
			if err := tx.Save(unit); err != nil {
				return err
			}
			view.UnitID = unit.ID()
		}
		if err := tx.Save(state); err != nil {
			return err
		}
		result.Crate, result.Prize = crateID, view
		opening, err := tx.New(CrateOpenings)
		if err != nil {
			return err
		}
		stored, err := json.Marshal(CrateResult{Crate: crateID, Prize: view, LevelReward: result.LevelReward})
		if err != nil {
			return err
		}
		setAll(opening, map[string]any{"user": user, "request_key": requestKey, "crate": crateID, "result": json.RawMessage(stored)})
		if err := tx.Save(opening); err != nil {
			return err
		}
		result.State = PlayerView(state)
		result.Pantry, err = ownerPantryView(tx, user, state)
		return err
	})
	return result, err
}

// grantFreeCrate adds one free crate to the HUD's "Caixas", up to the limit.
func grantFreeCrate(state Record) bool {
	if state.GetInt("crates_current") >= gamerules.CrateRulesNow().FreeMax {
		return false
	}
	state.Set("crates_current", state.GetInt("crates_current")+1)
	return true
}

// applySpice changes a batch being seasoned with a pantry spice; the regular
// seasoning bonus is already set on the job.
func applySpice(job Record, spice gamerules.Spice, now time.Time) {
	switch spice.Effect {
	case gamerules.SpiceServings:
		base := 1
		if recipe, ok := gamerules.RecipeByID(job.GetString("recipe_id")); ok {
			base = recipe.Servings
		}
		job.Set("bonus_servings", job.GetInt("bonus_servings")+spice.ExtraServings(base))
	case gamerules.SpiceRush:
		shortenCooking(job, spice.Percent, now)
	case gamerules.SpiceInstant:
		shortenCooking(job, 100, now)
	}
	job.Set("spice", spice.Code)
}

// shortenCooking takes percent of the time left on the fire, counted from the
// later of now and the start; the wait before spoiling moves with the ready
// instant. It returns the time saved.
func shortenCooking(job Record, percent int, now time.Time) time.Duration {
	from := job.GetTime("started_at")
	if now.After(from) {
		from = now
	}
	ready := job.GetTime("ready_at")
	left := ready.Sub(from)
	if left <= 0 {
		return 0
	}
	shift := left * time.Duration(percent) / 100
	if percent >= 100 {
		shift = left
	}
	job.Set("ready_at", ready.Add(-shift))
	if spoils := job.GetTime("spoils_at"); !spoils.IsZero() {
		job.Set("spoils_at", spoils.Add(-shift))
	}
	return shift
}

// PantryErrorStatus maps a pantry or crate error to its HTTP status and message.
func PantryErrorStatus(err error) (int, string) {
	switch {
	case errors.Is(err, ErrSpiceUnknown), errors.Is(err, ErrCrateUnknown), errors.Is(err, ErrCrateRequest):
		return 400, err.Error()
	case errors.Is(err, ErrSpiceCoins), errors.Is(err, ErrSpiceEmpty), errors.Is(err, ErrSpiceOwner), errors.Is(err, ErrCrateEmpty),
		errors.Is(err, ErrCrateCoins), errors.Is(err, ErrCrateCash), errors.Is(err, ErrSpiceFull), errors.Is(err, ErrPantryCash),
		errors.Is(err, ErrPantryEmpty), errors.Is(err, ErrPantryUse), errors.Is(err, ErrEnergyFull):
		return 409, err.Error()
	}
	return 500, "Não foi possível concluir agora."
}

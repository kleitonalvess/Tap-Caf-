import { apiFetch } from './backend';
/** Rules published by the server (shared/gamerules); the client only reads them. */
export interface RecipeRule {
  id: string;
  name: string;
  level: number;
  costCoins: number;
  cookSeconds: number;
  servings: number;
  pricePerServing: number;
  xpPerServing: number;
  spoilSeconds: number;
  provisional?: boolean;
}

/** One café expansion: the new side, the level that allows paying with coins, and its prices. */
export interface ExpansionStep { tiles: number; level: number; coins: number; cash: number; xp: number }
export interface ExpansionRules { startTiles: number; rewardCoins: number; steps: ExpansionStep[] }

export interface GameRules {
  recipes: RecipeRule[];
  /** cancelRefundPercent: share of the cost returned when a batch is cancelled while it cooks (all of it while preparing). */
  stove: { prepareSeconds: number; cleaningCoins: number; cleaningXp: number; seasonBonusPercent: number; seasonXp: number; cancelRefundPercent?: number };
  customers: { patienceSeconds: number; cookingArrivalFactor: number };
  levels?: { level: number; requiredXp: number; rewardCoins: number }[];
  /** How many employees a café keeps from each level (game-config amountLocks). */
  employeeLocks?: { employees: number; level: number }[];
  expansions?: ExpansionRules;
  /** Self-service pickup time and the waiter's tip (provisional design values). */
  service?: { selfPickupMs: number; waiterTipPercent: number; waiterTipMin: number };
  /** hireCoins: one-time fee of each employee slot, the first at index 0. */
  staff?: { hireCoins: number[] };
  /** Farm (fresh ingredients) and disco (party) across the street; provisional values. */
  street?: {
    farm: { cooldownSeconds: number; bonusPercent: number; maxCharges: number };
    disco: { durationSeconds: number; cooldownSeconds: number; arrivalFactor: number; tipMultiplier: number };
  };
  /** Whole popularity points; the café keeps tenths. */
  popularity?: { min: number; max: number; satisfiedDelta: number; unsatisfiedDelta: number };
  customerFrequency?: { popularity: number; perMinute: number }[];
  daily?: { days: { day: number; coins: number; cash: number; spices?: number }[] };
  /** The pantry's special spices (codes 800001–800003). */
  spices?: { list: Array<{ code: number; name: string; effect: 'double' | 'rush' | 'preserve'; description: string; priceCoins: number }> };
  /** Stoves and counters allowed per expansion step, and the share a sale returns. */
  equipment?: { stoves: number[]; counters: number[]; sellPercent: number };
}

export async function loadGameRules(signal?: AbortSignal): Promise<GameRules> {
  const response = await apiFetch('/api/coffe/rules', {
    credentials: 'same-origin',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Não foi possível carregar as regras do jogo.');
  const rules = await response.json() as GameRules;
  if (!Array.isArray(rules.recipes) || rules.recipes.length === 0) throw new Error('Regras do jogo inválidas.');
  return rules;
}

export type RecipeAvailability = 'locked' | 'free' | 'unaffordable' | 'available';

export interface CookingContext {
  level: number;
  gold: number;
  /** Server-side emergency help: this recipe costs nothing right now. */
  emergencyRecipeId?: string;
  /** Fresh farm ingredients waiting: the next batch pays this much more per serving. */
  freshPercent?: number;
}

export function recipeAvailability(recipe: RecipeRule, context: CookingContext): RecipeAvailability {
  if (context.level < recipe.level) return 'locked';
  if (context.emergencyRecipeId === recipe.id) return 'free';
  return context.gold < recipe.costCoins ? 'unaffordable' : 'available';
}

/** "15 s", "2 min", "1 h 30 min". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** The book's four tabs: every recipe, the quick ones, the most profitable and the unlocked ones. */
export const RECIPE_TABS = [
  { id: 'all', label: 'Todas' },
  { id: 'quick', label: 'Rápidas' },
  { id: 'profitable', label: 'Lucrativas' },
  { id: 'unlocked', label: 'Desbloqueadas' },
] as const;
export type RecipeTab = typeof RECIPE_TABS[number]['id'];
/** "Rápidas": ready within ten minutes. */
export const QUICK_RECIPE_SECONDS = 600;

/** Coins a batch returns over its cost when every serving is paid. */
export function recipeProfit(recipe: RecipeRule): number {
  return recipe.servings * recipe.pricePerServing - recipe.costCoins;
}

/** The recipes of a tab, in the order the tab shows them. */
export function recipeTab(recipes: readonly RecipeRule[], tab: RecipeTab, level: number): RecipeRule[] {
  const list = [...recipes];
  switch (tab) {
    case 'quick':
      return list.filter((recipe) => recipe.cookSeconds <= QUICK_RECIPE_SECONDS).sort((a, b) => a.cookSeconds - b.cookSeconds);
    case 'profitable':
      return list.sort((a, b) => recipeProfit(b) - recipeProfit(a) || b.servings - a.servings);
    case 'unlocked':
      return list.filter((recipe) => recipe.level <= level);
    default:
      return list;
  }
}

export interface LevelUnlocks {
  /** Recipes whose level was reached by this level-up. */
  recipes: RecipeRule[];
  slotsBefore: number;
  slotsAfter: number;
  /** Expansions that may now be paid with coins (the café is still smaller). */
  expansions: ExpansionStep[];
}

type UnlockRules = Pick<GameRules, 'recipes' | 'employeeLocks' | 'expansions'>;

export function employeeSlots(rules: Pick<GameRules, 'employeeLocks'>, level: number): number {
  let slots = 0;
  for (const lock of rules.employeeLocks ?? []) if (level >= lock.level) slots = lock.employees;
  return slots;
}

/**
 * What opened between two levels (exclusive → inclusive): several at once on big XP jumps.
 * Expansions the café already has (bought earlier with cash) are left out.
 */
export function levelUnlocks(rules: UnlockRules, fromLevel: number, toLevel: number, roomTiles = 0): LevelUnlocks {
  return {
    recipes: rules.recipes.filter((recipe) => recipe.level > fromLevel && recipe.level <= toLevel)
      .sort((a, b) => a.level - b.level || a.costCoins - b.costCoins),
    slotsBefore: employeeSlots(rules, fromLevel),
    slotsAfter: employeeSlots(rules, toLevel),
    expansions: (rules.expansions?.steps ?? []).filter((step) => step.level > fromLevel && step.level <= toLevel && step.tiles > roomTiles),
  };
}

export interface NextUnlocks { recipeLevel?: number; recipes: RecipeRule[]; slotLevel?: number; expansion?: ExpansionStep }

/** The next goals after a level: the nearest locked recipe(s), the next staff slot and coin expansion. */
export function nextUnlocks(rules: UnlockRules, level: number, roomTiles = 0): NextUnlocks {
  const upcoming = rules.recipes.filter((recipe) => recipe.level > level);
  const recipeLevel = upcoming.length ? Math.min(...upcoming.map((recipe) => recipe.level)) : undefined;
  const slotLevel = (rules.employeeLocks ?? []).find((lock) => lock.level > level)?.level;
  const expansion = (rules.expansions?.steps ?? []).find((step) => step.level > level && step.tiles > roomTiles);
  return {
    recipes: recipeLevel === undefined ? [] : upcoming.filter((recipe) => recipe.level === recipeLevel),
    ...(recipeLevel !== undefined ? { recipeLevel } : {}),
    ...(slotLevel !== undefined ? { slotLevel } : {}),
    ...(expansion ? { expansion } : {}),
  };
}

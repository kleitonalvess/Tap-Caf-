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

export interface GameRules {
  recipes: RecipeRule[];
  stove: { prepareSeconds: number; cleaningCoins: number; cleaningXp: number; seasonBonusPercent: number; seasonXp: number };
  customers: { patienceSeconds: number; cookingArrivalFactor: number };
  levels?: { level: number; requiredXp: number; rewardCoins: number }[];
  /** How many employees a café keeps from each level (game-config amountLocks). */
  employeeLocks?: { employees: number; level: number }[];
}

export async function loadGameRules(signal?: AbortSignal): Promise<GameRules> {
  const response = await fetch('/api/coffe/rules', {
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

export interface RecipePage {
  label: string;
  recipes: RecipeRule[];
}

/** Book pages in catalogue order, labelled by the levels they unlock at. */
export function recipePages(recipes: readonly RecipeRule[], perPage = 6, maxPages = 4): RecipePage[] {
  const pages: RecipePage[] = [];
  for (let i = 0; i < recipes.length && pages.length < maxPages; i += perPage) {
    const slice = recipes.slice(i, i + perPage);
    const low = Math.min(...slice.map((recipe) => recipe.level));
    const high = Math.max(...slice.map((recipe) => recipe.level));
    pages.push({ label: low === high ? `Nível ${low}` : `Nível ${low}–${high}`, recipes: slice });
  }
  return pages;
}

export interface LevelUnlocks {
  /** Recipes whose level was reached by this level-up. */
  recipes: RecipeRule[];
  slotsBefore: number;
  slotsAfter: number;
}

export function employeeSlots(rules: Pick<GameRules, 'employeeLocks'>, level: number): number {
  let slots = 0;
  for (const lock of rules.employeeLocks ?? []) if (level >= lock.level) slots = lock.employees;
  return slots;
}

/** What opened between two levels (exclusive → inclusive): several at once on big XP jumps. */
export function levelUnlocks(rules: Pick<GameRules, 'recipes' | 'employeeLocks'>, fromLevel: number, toLevel: number): LevelUnlocks {
  return {
    recipes: rules.recipes.filter((recipe) => recipe.level > fromLevel && recipe.level <= toLevel)
      .sort((a, b) => a.level - b.level || a.costCoins - b.costCoins),
    slotsBefore: employeeSlots(rules, fromLevel),
    slotsAfter: employeeSlots(rules, toLevel),
  };
}

/** The next goals after a level: the nearest locked recipe(s) and the next staff slot. */
export function nextUnlocks(rules: Pick<GameRules, 'recipes' | 'employeeLocks'>, level: number): { recipeLevel?: number; recipes: RecipeRule[]; slotLevel?: number } {
  const upcoming = rules.recipes.filter((recipe) => recipe.level > level);
  const recipeLevel = upcoming.length ? Math.min(...upcoming.map((recipe) => recipe.level)) : undefined;
  const slotLevel = (rules.employeeLocks ?? []).find((lock) => lock.level > level)?.level;
  return {
    recipes: recipeLevel === undefined ? [] : upcoming.filter((recipe) => recipe.level === recipeLevel),
    ...(recipeLevel !== undefined ? { recipeLevel } : {}),
    ...(slotLevel !== undefined ? { slotLevel } : {}),
  };
}

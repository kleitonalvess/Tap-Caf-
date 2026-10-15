import type { GameRules } from './game-rules';
import type { PlayerState } from './player-state';
import { request } from './rewards';

/** Achievements and daily missions (shared/cafe/progress.go); the server counts and pays. */
export interface Reward { coins: number; xp: number; cash: number }
export interface Achievement {
  id: string; code?: number; name: string; description: string; stat: string;
  progress: number;
  /** Tiers already claimed: the next goal is goals[claimed]. */
  claimed: number;
  goals: Array<{ target: number } & Reward>;
  claimable: boolean;
}
export interface Mission extends Reward {
  id: string; title: string;
  goals: Array<{ stat: string; target: number; progress: number }>;
  complete: boolean; claimed: boolean;
}
export interface ProgressSnapshot {
  achievements: Achievement[];
  missions: Mission[];
  /** Rewards waiting for "Resgatar": the badge on the trophy. */
  ready: number;
  /** Unix ms of the next São Paulo midnight, when the missions change. */
  nextAt: number;
}
export interface ProgressClaim { reward: Reward; levelReward?: number; progress: ProgressSnapshot; state: PlayerState }

export const loadProgress = (): Promise<ProgressSnapshot> => request('/api/coffe/progress');
export const claimProgress = (kind: 'achievement' | 'mission', id: string): Promise<ProgressClaim> =>
  request('/api/coffe/progress/claim', { kind, id });
export const renameCafe = (name: string): Promise<PlayerState> => request('/api/coffe/cafe/name', { name });

/** Medal of each tier: three for the project's achievements, five for the config's. */
export const TIER_NAMES = ['Bronze', 'Prata', 'Ouro', 'Platina', 'Diamante'] as const;
export const TIER_COLORS = [0xb06a32, 0x9aa4ad, 0xd9a520, 0x5fb3b3, 0x6aa8e8] as const;

/** Where an achievement stands: the goal it chases and how far along, or done. */
export function achievementStep(achievement: Achievement): { tier: number; target: number; done: boolean; fraction: number } {
  const done = achievement.claimed >= achievement.goals.length;
  const tier = Math.min(achievement.claimed, achievement.goals.length - 1);
  const target = achievement.goals[tier]?.target ?? 1;
  return { tier, target, done, fraction: done ? 1 : Math.min(1, achievement.progress / target) };
}

/** "+100 moedas · +10 XP · +2 Grana". */
export function rewardLine(reward: Reward): string {
  const parts: string[] = [];
  if (reward.coins > 0) parts.push(`+${reward.coins.toLocaleString('pt-BR')} moedas`);
  if (reward.xp > 0) parts.push(`+${reward.xp.toLocaleString('pt-BR')} XP`);
  if (reward.cash > 0) parts.push(`+${reward.cash.toLocaleString('pt-BR')} Grana`);
  return parts.join(' · ');
}

/** The mission's best goal, as "3/6". */
export function missionProgress(mission: Mission): string {
  const best = [...mission.goals].sort((a, b) => b.progress / b.target - a.progress / a.target)[0];
  return best ? `${best.progress}/${best.target}` : '';
}

const number = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/** How popularity works, from the rules the server plays by. */
export function popularityLines(rules?: GameRules): string[] {
  const p = rules?.popularity ?? { min: 5, max: 105, satisfiedDelta: 0.1, unsatisfiedDelta: 0.3 };
  const bands = rules?.customerFrequency ?? [];
  const lines = [
    `Cada cliente que come e paga: +${number(p.satisfiedDelta)}. Cada cliente que sai bravo: −${number(p.unsatisfiedDelta)}.`,
    'Clientes saem bravos sem mesa limpa ou quando a comida não chega antes da paciência acabar.',
    'Com a cozinha parada (nada no fogo e nada no balcão), quem só olha o cardápio sai sem tirar nota.',
  ];
  if (bands.length) {
    lines.push(`Quanto maior a nota, mais clientes chegam: de ${bands[0]!.perMinute} a ${bands.at(-1)!.perMinute} por minuto (a partir de ${bands.at(-1)!.popularity}).`);
  }
  lines.push(`A nota vai de ${p.min} a ${p.max} e não cai enquanto você está fora.`);
  return lines;
}

/** Where Moedas and Grana come from, with the amounts of the current rules. */
export function currencySources(kind: 'gold' | 'cash', rules?: GameRules): string[] {
  const days = rules?.daily?.days ?? [];
  const reward = rules?.expansions?.rewardCoins;
  if (kind === 'gold') {
    const coins = days.map((day) => day.coins).filter((value) => value > 0);
    return [
      'Cozinhando: cada porção que um cliente come paga moedas; o garçom ainda traz gorjeta.',
      coins.length ? `Bônus diário: de ${number(Math.min(...coins))} a ${number(Math.max(...coins))} moedas por dia de sequência.` : 'Bônus diário: moedas a cada dia de sequência.',
      'Conquistas e missões diárias: moedas a cada meta resgatada.',
      reward ? `Expansões: +${number(reward)} moedas ao concluir cada ampliação do café.` : 'Expansões: moedas ao concluir cada ampliação.',
      'Subir de nível: cada nível novo paga um prêmio em moedas.',
    ];
  }
  const cashDays = days.filter((day) => day.cash > 0).map((day) => `${day.day}º dia: +${day.cash}`);
  return [
    cashDays.length ? `Bônus diário: ${cashDays.join(', ')} Grana.` : 'Bônus diário: Grana nos dias especiais da sequência.',
    'Missões diárias: +1 Grana a cada missão resgatada (3 por dia).',
    'Conquistas: os níveis Prata e Ouro também pagam Grana.',
    'Use a Grana para expandir o café sem esperar o nível.',
  ];
}

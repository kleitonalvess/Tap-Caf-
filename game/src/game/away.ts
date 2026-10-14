/** What the café did while the owner was away (shared/gamewire AwaySummary). */
export interface AwaySummary {
  from: number;
  to: number;
  simulatedMs: number;
  /** The part of the absence left out by the server's limit (0 when none). */
  cappedMs: number;
  served: number;
  /** coins includes tips and freshCoins. */
  coins: number;
  tips: number;
  freshCoins: number;
  xp: number;
  levelFrom: number;
  levelTo: number;
  /** Popularity in tenths. */
  popularityFrom: number;
  popularityTo: number;
  plates: number;
  cleared: number;
  waiters: number;
  cleaners: number;
  servingsLeft: number;
  readyDishes: number;
  spoiledDishes: number;
}

/** "45 min", "2 h 15 min", "3 dias". */
export function formatAway(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  return `${Math.floor(hours / 24)} dias`;
}

/**
 * What a merged summary (same start as one already shown) adds to it, so
 * the earnings of the first absence are not shown or floated twice.
 */
export function awayAddition(merged: AwaySummary, shown: AwaySummary): AwaySummary {
  return {
    ...merged,
    from: shown.to,
    simulatedMs: Math.max(0, merged.simulatedMs - shown.simulatedMs),
    cappedMs: Math.max(0, (merged.cappedMs ?? 0) - (shown.cappedMs ?? 0)),
    served: Math.max(0, merged.served - shown.served),
    coins: Math.max(0, merged.coins - shown.coins),
    tips: Math.max(0, merged.tips - shown.tips),
    freshCoins: Math.max(0, merged.freshCoins - shown.freshCoins),
    xp: Math.max(0, merged.xp - shown.xp),
    cleared: Math.max(0, merged.cleared - shown.cleared),
    levelFrom: shown.levelTo,
    popularityFrom: shown.popularityTo,
  };
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
const tenths = (value: number): string => (value / 10).toFixed(1).replace('.', ',');

export interface AwayLine { text: string; tone: 'good' | 'info' | 'warn' }

/** The lines of the "Bem-vindo de volta!" window, in reading order. */
export function awayLines(summary: AwaySummary): AwayLine[] {
  const lines: AwayLine[] = [];
  const staffed = summary.waiters + summary.cleaners > 0;
  if (summary.served === 0) {
    lines.push({ text: summary.servingsLeft > 0 ? 'Nenhum cliente achou mesa limpa para comer.' : 'O café ficou fechado: não havia comida no balcão.', tone: 'warn' });
  } else {
    const who = summary.waiters > 0 ? 'Seus garçons serviram' : 'Seus clientes se serviram de';
    lines.push({ text: `${who} ${plural(summary.served, 'porção', 'porções')}.`, tone: 'good' });
    const extras = [summary.tips > 0 ? `${summary.tips} de gorjeta` : '', summary.freshCoins > 0 ? `${summary.freshCoins} de ingredientes frescos` : ''].filter(Boolean);
    lines.push({ text: `+${summary.coins} moedas${extras.length ? ` (${extras.join(' e ')})` : ''} e +${summary.xp} XP`, tone: 'good' });
  }
  if (summary.levelTo > summary.levelFrom) lines.push({ text: `Você subiu para o nível ${summary.levelTo}!`, tone: 'good' });
  if (summary.popularityTo !== summary.popularityFrom) {
    lines.push({ text: `Popularidade: ${tenths(summary.popularityFrom)} → ${tenths(summary.popularityTo)}`, tone: 'info' });
  }
  if (summary.cleared > 0) lines.push({ text: `A equipe recolheu ${plural(summary.cleared, 'prato', 'pratos')}.`, tone: 'info' });
  if (summary.plates > 0) lines.push({ text: `${plural(summary.plates, 'prato sujo espera', 'pratos sujos esperam')} na mesa${staffed ? '' : ' (contrate um faxineiro)'}.`, tone: 'warn' });
  if (summary.readyDishes > 0) lines.push({ text: `${plural(summary.readyDishes, 'prato pronto espera', 'pratos prontos esperam')} no fogão: sirva antes que estrague!`, tone: 'warn' });
  if (summary.spoiledDishes > 0) lines.push({ text: `${plural(summary.spoiledDishes, 'prato estragou', 'pratos estragaram')} no fogão.`, tone: 'warn' });
  if (summary.served > 0 && summary.servingsLeft === 0) lines.push({ text: 'O balcão esvaziou: cozinhe para reabrir.', tone: 'info' });
  return lines;
}

export async function acknowledgeAway(): Promise<void> {
  try {
    await fetch('/api/coffe/room/away/ack', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
  } catch {
    // The summary stays on the server and shows again next time; nothing is lost.
  }
}

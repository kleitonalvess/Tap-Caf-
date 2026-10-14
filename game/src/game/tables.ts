import { apiFetch } from './backend';
const endpoint = '/api/coffe/room/tables/clean';

export interface TableCleaned { tableId: string; plates: number; xp: number }

/**
 * Clears the dishes on one of the player's tables. The room server checks that
 * the avatar stands beside it; the new (clean) state arrives as a `dirt` event.
 */
export async function cleanTable(tableId: string): Promise<TableCleaned> {
  let response: Response;
  try {
    response = await apiFetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableId }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error('Não foi possível conectar ao servidor.');
  }
  if (response.status === 401) {
    window.location.replace('/');
    throw new Error('Sua sessão expirou. Entre novamente.');
  }
  let body: { message?: unknown; tableId?: unknown; plates?: unknown; xp?: unknown } = {};
  try { body = await response.json() as typeof body; } catch { /* Corpo vazio: usa a mensagem padrão. */ }
  if (!response.ok) throw new Error(typeof body.message === 'string' && body.message ? body.message : 'Não foi possível limpar a mesa.');
  return { tableId, plates: Number(body.plates) || 0, xp: Number(body.xp) || 0 };
}

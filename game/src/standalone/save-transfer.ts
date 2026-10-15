import { validRecord, type SaveRecord } from './save-store';

/** The exported file: the browser's save, tagged so another JSON is never
 * taken for a café. The engine still checks the café itself before any
 * import replaces the current one (LocalBackend.check). */
export const SAVE_FILE_FORMAT = 'coffe-mania-save';
/** A full café is far smaller; anything larger is not a save (same bound as the engine). */
export const MAX_SAVE_FILE_BYTES = 16 * 1024 * 1024;

export interface SaveFile {
  format: typeof SAVE_FILE_FORMAT;
  version: 1;
  gameVersion: string;
  exportedAt: number;
  save: SaveRecord;
}

export function saveFileText(record: SaveRecord, gameVersion: string, now = Date.now()): string {
  const file: SaveFile = { format: SAVE_FILE_FORMAT, version: 1, gameVersion, exportedAt: now, save: record };
  return JSON.stringify(file);
}

/** "coffe-mania-2026-10-15.json", by the local date. */
export function saveFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `coffe-mania-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** Reads an exported file and returns its save, or throws a message for the player. */
export function parseSaveFile(text: string): SaveRecord {
  if (!text || text.length > MAX_SAVE_FILE_BYTES) throw new Error('Este arquivo não é um save do Coffe Mania.');
  let file: Partial<SaveFile> | null;
  try {
    file = JSON.parse(text) as Partial<SaveFile> | null;
  } catch {
    throw new Error('O arquivo está corrompido (JSON inválido).');
  }
  if (!file || typeof file !== 'object' || file.format !== SAVE_FILE_FORMAT) throw new Error('Este arquivo não é um save do Coffe Mania.');
  if (file.version !== 1) throw new Error('Este save é de uma versão do jogo que não sabemos abrir.');
  if (!validRecord(file.save)) throw new Error('O save está incompleto ou foi alterado.');
  let data: { version?: unknown; collections?: unknown } | null;
  try {
    data = JSON.parse(file.save.data) as typeof data;
  } catch {
    throw new Error('O café dentro do save está corrompido.');
  }
  const collections = data?.collections as Record<string, unknown> | undefined;
  if (!data || data.version !== 1 || !collections || typeof collections !== 'object' || Array.isArray(collections)) {
    throw new Error('O café dentro do save está corrompido.');
  }
  for (const name of ['player_state', 'player_rooms']) {
    if (!Array.isArray(collections[name]) || !(collections[name] as unknown[]).length) throw new Error('O save não tem os dados do café.');
  }
  return file.save;
}

/** What the player is about to load: "Café do Zé · nível 7 · 1.234 moedas · salvo em 15/10/2026 14:03". */
export function saveSummary(record: SaveRecord): string {
  const parts: string[] = [];
  try {
    const data = JSON.parse(record.data) as { collections?: Record<string, Array<{ fields?: Record<string, unknown> }>> };
    const fields = data.collections?.player_state?.find((row) => row.fields?.user === record.profile.id)?.fields;
    if (typeof fields?.cafe_name === 'string' && fields.cafe_name) parts.push(fields.cafe_name);
    if (typeof fields?.level === 'number') parts.push(`nível ${fields.level}`);
    if (typeof fields?.gold === 'number') parts.push(`${fields.gold.toLocaleString('pt-BR')} moedas`);
  } catch { /* parseSaveFile already refused an unreadable café */ }
  parts.push(`salvo em ${new Date(record.savedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`);
  return parts.join(' · ');
}

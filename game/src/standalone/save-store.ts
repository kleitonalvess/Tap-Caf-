import type { LocalProfile } from './protocol';

/** The browser's café: the whole MemoryStore (Go's Export) plus who plays it. */
export interface SaveRecord { version: 1; profile: LocalProfile; savedAt: number; data: string }

export interface SaveStore {
  /** The newest valid save, or null for a new café. */
  load(): Promise<SaveRecord | null>;
  save(record: SaveRecord): Promise<void>;
  /** Synchronous copy for page exit, when an IndexedDB write may not finish. */
  backup(record: SaveRecord): void;
}

export const SAVE_KEY = 'coffe-standalone-save';
const DATABASE = 'coffe-mania';
const OBJECTS = 'saves';

export function validRecord(value: unknown): value is SaveRecord {
  const record = value as Partial<SaveRecord> | null;
  return !!record && record.version === 1 && typeof record.data === 'string' && Number.isFinite(record.savedAt)
    && typeof record.profile?.id === 'string' && /^[a-z0-9]{15}$/.test(record.profile.id) && typeof record.profile.name === 'string';
}

/** The newer of two saves; equal instants keep the first. */
export function newest(a: SaveRecord | null, b: SaveRecord | null): SaveRecord | null {
  if (!a) return b;
  if (!b) return a;
  return b.savedAt > a.savedAt ? b : a;
}

export function readStorage(storage: Pick<Storage, 'getItem'> | null): SaveRecord | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(SAVE_KEY) ?? 'null');
    return validRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStorage(storage: Pick<Storage, 'setItem'> | null, record: SaveRecord): boolean {
  try {
    storage?.setItem(SAVE_KEY, JSON.stringify(record));
    return !!storage;
  } catch {
    return false;
  }
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('IndexedDB'));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  const open = indexedDB.open(DATABASE, 1);
  open.onupgradeneeded = () => { open.result.createObjectStore(OBJECTS); };
  return request(open);
}

function safeLocalStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/** IndexedDB first; localStorage when it is missing (some private modes) and for
 * the exit backup. Loading picks whichever copy is newer. */
export async function openSaveStore(): Promise<SaveStore> {
  const storage = safeLocalStorage();
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
  } catch (error) {
    console.warn('[offline] IndexedDB indisponível; o save fica no localStorage', error);
  }
  return {
    async load() {
      let stored: SaveRecord | null = null;
      if (database) {
        try {
          const value: unknown = await request(database.transaction(OBJECTS).objectStore(OBJECTS).get('main'));
          if (validRecord(value)) stored = value;
        } catch (error) {
          console.warn('[offline] save do IndexedDB ilegível', error);
        }
      }
      return newest(stored, readStorage(storage));
    },
    async save(record) {
      if (database) {
        const transaction = database.transaction(OBJECTS, 'readwrite');
        transaction.objectStore(OBJECTS).put(record, 'main');
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB'));
          transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB'));
        });
        return;
      }
      if (!writeStorage(storage, record)) throw new Error('Não há onde salvar o café neste navegador.');
    },
    backup(record) { writeStorage(storage, record); },
  };
}

/** A new local player id, shaped like the server's record ids. */
export function newProfileId(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(random(new Uint8Array(15)), (byte) => alphabet[byte % alphabet.length]).join('');
}

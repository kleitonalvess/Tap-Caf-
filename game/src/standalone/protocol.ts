/** Messages between the page and the Web Worker that runs the café (Go/WASM). */

/** The local player: one café per browser, never a server account. */
export interface LocalProfile { id: string; name: string }

export type ToEngine =
  | { type: 'start'; execUrl: string; wasmUrl: string; save: string | null; profile: LocalProfile; lastSeen: number }
  | { type: 'fetch'; id: number; method: string; path: string; body: string }
  | { type: 'connect'; conn: number }
  | { type: 'send'; conn: number; data: string }
  | { type: 'disconnect'; conn: number }
  /** The page is hidden: the room sleeps and the café is saved at once. */
  | { type: 'suspend'; id: number }
  | { type: 'resume' }
  /** Importing a save: can the engine open it for this profile? It comes back
   * frozen in time (clocks moved by the time since savedAt). */
  | { type: 'prepare'; id: number; save: string; profileId: string; savedAt: number };

export type FromEngine =
  | { type: 'started' }
  | { type: 'failed'; message: string }
  | { type: 'response'; id: number; status: number; body: string }
  | { type: 'rejected'; id: number; message: string }
  | { type: 'message'; conn: number; data: string }
  | { type: 'close'; conn: number }
  /** The player's HUD values changed. */
  | { type: 'state' }
  /** The whole café after one or more game transactions. */
  | { type: 'save'; data: string }
  | { type: 'suspended'; id: number }
  /** Empty error: save is the café to store. */
  | { type: 'prepared'; id: number; save: string; error: string };

import { describe, expect, it } from 'vitest';

import { parseSaveFile, saveFileName, saveFileText, saveSummary } from '../../game/src/standalone/save-transfer';
import type { SaveRecord } from '../../game/src/standalone/save-store';

const cafe = JSON.stringify({ version: 1, seq: 3, collections: {
  player_state: [{ id: 'p1', created: '', seq: 1, fields: { user: 'localtest000001', cafe_name: 'Café do Zé', level: 7, gold: 1234 } }],
  player_rooms: [{ id: 'r1', created: '', seq: 2, fields: { user: 'localtest000001' } }],
} });
const record: SaveRecord = { version: 1, profile: { id: 'localtest000001', name: 'Jogador' }, savedAt: Date.UTC(2026, 9, 15, 17, 3), data: cafe };

describe('save files', () => {
  it('round-trips an exported save', () => {
    expect(parseSaveFile(saveFileText(record, '0.0.4.19'))).toEqual(record);
  });

  it('names the file by date', () => {
    expect(saveFileName(new Date(2026, 9, 5))).toBe('coffe-mania-2026-10-05.json');
  });

  it('refuses anything that is not an intact save', () => {
    const file = JSON.parse(saveFileText(record, '0.0.4.19')) as Record<string, unknown>;
    const cases: Array<[string, string]> = [
      ['', 'não é um save'],
      ['{oops', 'JSON inválido'],
      [JSON.stringify({ ...file, format: 'outro-jogo' }), 'não é um save'],
      [JSON.stringify({ ...file, version: 2 }), 'versão'],
      [JSON.stringify({ ...file, save: { ...record, profile: { id: '../x', name: 'a' } } }), 'incompleto'],
      [JSON.stringify({ ...file, save: { ...record, data: '{' } }), 'corrompido'],
      [JSON.stringify({ ...file, save: { ...record, data: JSON.stringify({ version: 1, collections: { player_state: [] } }) } }), 'dados do café'],
    ];
    for (const [text, message] of cases) expect(() => parseSaveFile(text), text.slice(0, 40)).toThrow(message);
  });

  it('summarises what the player is about to load', () => {
    const summary = saveSummary(record);
    expect(summary).toMatch(/^Café do Zé · nível 7 · 1\.234 moedas · salvo em /);
  });
});

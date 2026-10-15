import { describe, expect, it } from 'vitest';

import { farmCaption, farmStatus, formatClock, partyCaption, partyStatus } from '../../game/src/game/street';
import { FESTA_DO_BAIRRO, PROCEDURAL_SONGS, validateSong } from '../../game/src/audio/music';

const now = 1_000_000;

describe('farm', () => {
  it('is ready with no harvest yet and counts down after one', () => {
    expect(farmStatus(undefined, now)).toMatchObject({ canHarvest: true, readyInMs: 0, charges: 0 });
    const growing = farmStatus({ farmReadyAt: now + 65_000 }, now);
    expect(growing).toMatchObject({ canHarvest: false, readyInMs: 65_000 });
    expect(farmCaption(growing)).toBe('Colheita em 1:05');
  });

  it('holds back a harvest while the fresh charge is unused', () => {
    const full = farmStatus({ freshCharges: 1 }, now, 1);
    expect(full).toMatchObject({ canHarvest: false, full: true });
    expect(farmCaption(full)).toBe('Ingredientes frescos guardados!');
    expect(farmStatus({ freshCharges: 1 }, now, 2).canHarvest).toBe(true);
  });
});

describe('disco party', () => {
  const street = { partyStartedAt: now - 60_000, partyEndsAt: now + 240_000, partyReadyAt: now + 2_040_000 };

  it('runs between its instants and rests afterwards', () => {
    expect(partyStatus(street, now)).toMatchObject({ active: true, endsInMs: 240_000, canStart: false });
    expect(partyCaption(partyStatus(street, now))).toBe('Festa! Termina em 4:00');
    const after = partyStatus(street, now + 300_000);
    expect(after).toMatchObject({ active: false, canStart: false, readyInMs: 1_740_000 });
    expect(partyStatus(street, now + 2_040_000).canStart).toBe(true);
    expect(partyStatus(undefined, now)).toMatchObject({ active: false, canStart: true });
  });

  it('plays its own valid song, outside the player-selectable list', () => {
    expect(validateSong(FESTA_DO_BAIRRO)).toBe('');
    expect(PROCEDURAL_SONGS).not.toContain(FESTA_DO_BAIRRO);
  });
});

describe('clock', () => {
  it('rounds up to whole seconds and shows hours when needed', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(1)).toBe('0:01');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });
});

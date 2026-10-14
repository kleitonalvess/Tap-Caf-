import { describe, expect, it } from 'vitest';

import { hireableProfiles, otherRole, staffSlots, type StaffSnapshot } from '../../game/src/game/staff';

const locks = [1, 7, 15, 23, 31, 39, 47].map((level, index) => ({ employees: index + 1, level }));
const snapshot = (slots: number, staff: StaffSnapshot['staff'] = []): StaffSnapshot => ({
  level: 1, slots, hireCoins: 0, staff,
  profiles: [
    { id: 'vostu', name: 'Amigo Vostu', role: 'waiter', tagline: '' },
    { id: 'dona_cida', name: 'Dona Cida', role: 'cleaner', tagline: '' },
  ],
});

describe('staff slots', () => {
  it('shows every lock: hired, free and locked with its level', () => {
    const slots = staffSlots(snapshot(2, [{ id: 's1', profile: 'vostu', name: 'Amigo Vostu', role: 'waiter' }]), locks);
    expect(slots.map((slot) => slot.kind)).toEqual(['staff', 'free', 'locked', 'locked', 'locked', 'locked', 'locked']);
    expect(slots[2]).toEqual({ kind: 'locked', level: 15 });
  });

  it('lists only characters not hired yet', () => {
    const hired = snapshot(1, [{ id: 's1', profile: 'vostu', name: 'Amigo Vostu', role: 'waiter' }]);
    expect(hireableProfiles(hired).map((profile) => profile.id)).toEqual(['dona_cida']);
  });

  it('switches between the two roles', () => {
    expect(otherRole('waiter')).toBe('cleaner');
    expect(otherRole('cleaner')).toBe('waiter');
  });
});

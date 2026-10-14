import { apiFetch } from './backend';
/** The café's employees: predefined characters today, hired friends later. */
export type StaffRole = 'waiter' | 'cleaner';

export const ROLE_LABEL: Readonly<Record<StaffRole, string>> = { waiter: 'Garçom', cleaner: 'Faxineiro' };

export interface StaffProfile { id: string; name: string; role: StaffRole; tagline: string }
export interface StaffMember { id: string; profile: string; name: string; role: StaffRole; friendUserId?: string }
export interface StaffSnapshot {
  level: number;
  slots: number;
  nextSlotLevel?: number;
  /** What the next hire costs: the fee of a slot never filled before, 0 for a paid one. */
  hireCoins: number;
  /** Slots already paid for; filling one of them again is free. */
  paidSlots?: number;
  /** One-time fee of each slot, the first at index 0. */
  slotFees?: number[];
  staff: StaffMember[];
  profiles: StaffProfile[];
}

/** fee: what filling the slot would cost (0 when free or already paid). */
export type StaffSlot =
  | { kind: 'staff'; member: StaffMember }
  | { kind: 'free'; fee: number }
  | { kind: 'locked'; level: number; fee: number };

/** One-time fee of a 0-based slot, 0 once it was paid. */
export function slotFee(snapshot: StaffSnapshot, index: number): number {
  if (index < Math.max(snapshot.paidSlots ?? 0, snapshot.staff.length)) return 0;
  const fees = snapshot.slotFees ?? [];
  return fees.length ? fees[Math.min(index, fees.length - 1)]! : 0;
}

/** One entry per employee lock: hired staff first, then free slots, then the locked ones with their level. */
export function staffSlots(snapshot: StaffSnapshot, locks: readonly { employees: number; level: number }[]): StaffSlot[] {
  const total = Math.max(snapshot.slots, locks.length, snapshot.staff.length);
  const slots: StaffSlot[] = [];
  for (let index = 0; index < total; index++) {
    const member = snapshot.staff[index];
    if (member) slots.push({ kind: 'staff', member });
    else if (index < snapshot.slots) slots.push({ kind: 'free', fee: slotFee(snapshot, index) });
    else slots.push({ kind: 'locked', level: locks.find((lock) => lock.employees === index + 1)?.level ?? snapshot.nextSlotLevel ?? 0, fee: slotFee(snapshot, index) });
  }
  return slots;
}

/** Characters not working in the café yet. */
export function hireableProfiles(snapshot: StaffSnapshot): StaffProfile[] {
  const hired = new Set(snapshot.staff.map((member) => member.profile));
  return snapshot.profiles.filter((profile) => !hired.has(profile.id));
}

export function otherRole(role: StaffRole): StaffRole {
  return role === 'waiter' ? 'cleaner' : 'waiter';
}

const endpoint = '/api/coffe/staff';

export class StaffClient {
  private async request(path: string, body?: Record<string, string>): Promise<StaffSnapshot> {
    let response: Response;
    try {
      response = await apiFetch(endpoint + path, {
        method: body ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error('Não foi possível conectar ao servidor.');
    }
    if (response.status === 401) {
      window.location.replace('/');
      throw new Error('Sua sessão expirou. Entre novamente.');
    }
    let data: unknown;
    try { data = await response.json(); } catch { data = undefined; }
    if (!response.ok) {
      const message = (data as { message?: unknown } | undefined)?.message;
      throw new Error(typeof message === 'string' && message ? message : 'Não foi possível atualizar os funcionários.');
    }
    const snapshot = data as StaffSnapshot;
    if (!snapshot || !Array.isArray(snapshot.staff) || !Array.isArray(snapshot.profiles)) throw new Error('Dados de funcionários inválidos.');
    return snapshot;
  }

  get(): Promise<StaffSnapshot> { return this.request(''); }
  hire(profileId: string, role: StaffRole): Promise<StaffSnapshot> { return this.request('/hire', { profileId, role }); }
  setRole(staffId: string, role: StaffRole): Promise<StaffSnapshot> { return this.request('/role', { staffId, role }); }
  dismiss(staffId: string): Promise<StaffSnapshot> { return this.request('/dismiss', { staffId }); }
}

import type { PlayerState } from './player-state';
import { request } from './rewards';

/** An entertainment machine (shared/cafe MachineView); the server derives the state. */
export interface MachineView {
  unitId: string; itemId: number; level: number; maxLevel: number;
  state: 'assembling' | 'idle' | 'running' | 'ready' | 'broken';
  parts: number; partsNeeded: number; nextCoins: number;
  activatedAt?: string; readyAt?: string; runs: number;
  runCoins: number; runXp: number; patiencePercent: number;
}
export interface MachinesResult { machines: MachineView[]; state: PlayerState; coins?: number; xp?: number; levelReward?: number }
export type MachineAction = 'install' | 'start' | 'collect' | 'repair';

export const loadMachines = (): Promise<{ machines: MachineView[] }> => request('/api/coffe/machines');
export const operateMachine = (action: MachineAction, unitId: string): Promise<MachinesResult> => request(`/api/coffe/machines/${action}`, { unitId });

/** A placed machine as the world event carries it (visitors see it too). */
export interface WorldMachine { unitId: string; level: number; state: MachineView['state']; runUntil?: number; patiencePercent: number }

/** The state at the server's now: a running machine whose run ended is ready. */
export function machineStateAt(machine: Pick<WorldMachine, 'state' | 'runUntil'>, nowMs: number): MachineView['state'] {
  if (machine.state === 'running' && machine.runUntil !== undefined && nowMs >= machine.runUntil) return 'ready';
  return machine.state;
}

/** One line for the machine's window: what it is doing and what comes next. */
export function machineStatus(machine: MachineView, nowMs: number, rules: { maintenanceRuns: number }): string {
  switch (machine.state) {
    case 'assembling': return `Em montagem: ${machine.parts}/${machine.partsNeeded} peças instaladas.`;
    case 'broken': return 'Quebrou depois de muitas rodadas: conserte para ligar de novo.';
    case 'running': {
      const left = machine.readyAt ? Math.max(0, Date.parse(machine.readyAt.replace(' ', 'T')) - nowMs) : 0;
      const minutes = Math.ceil(left / 60000);
      return `Ligada: clientes ${machine.patiencePercent}% mais pacientes. Rodada termina em ${minutes} min.`;
    }
    case 'ready': return `Rodada completa: colete ${machine.runCoins} moedas e ${machine.runXp} XP.`;
    default: return `Parada. Rodadas até a manutenção: ${Math.max(0, rules.maintenanceRuns - machine.runs)}.`;
  }
}

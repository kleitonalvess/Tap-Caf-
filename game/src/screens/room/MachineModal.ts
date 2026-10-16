import { Container, Graphics } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import { machineStatus, type MachineAction, type MachineView, type MachinesResult } from '../../game/machines';
import { DIALOG_COLORS, RoomDialog } from './RoomDialog';

interface MachineRules { startEnergy: number; repairEnergy: number; maintenanceRuns: number; runSeconds: number }

/**
 * Jukebox or arcade: level stars, the parts bar, the run and the buttons the
 * state allows (install a part, switch on, collect, repair). The server
 * checks parts, coins and energy; the window only shows what it answers.
 */
export class MachineModal extends RoomDialog {
  private machine?: MachineView;
  private name = '';
  private busy = false;
  private message = '';
  private messageError = false;

  constructor(private readonly options: {
    rules: () => MachineRules | undefined;
    parts: () => number;
    energy: () => number;
    serverNow: () => number;
    onAction: (action: MachineAction, unitId: string) => Promise<MachinesResult>;
    onDone: (result: MachinesResult, action: MachineAction) => void;
    audio?: SoundPlayer;
  }) {
    super('machine-modal', 1100, 720, options.audio);
  }

  get unitId(): string | undefined { return this.isOpen ? this.machine?.unitId : undefined; }

  show(machine: MachineView, name: string): void {
    this.machine = machine;
    this.name = name;
    this.message = '';
    this.render();
    this.reveal();
  }

  /** A fresher view from the server (another tab, the run ending). */
  refresh(machine: MachineView): void {
    if (!this.isOpen || machine.unitId !== this.machine?.unitId) return;
    this.machine = machine;
    this.render();
  }

  private render(): void {
    const machine = this.machine;
    const rules = this.options.rules();
    if (!machine || !rules) return;
    this.clear();
    this.text(this.name, this.width / 2, 36, 56, DIALOG_COLORS.title);
    // Level stars: filled up to the current level.
    const stars = new Container();
    stars.label = 'machine-level';
    for (let i = 0; i < machine.maxLevel; i++) {
      const star = new Graphics();
      const points: number[] = [];
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 14 : 32, a = -Math.PI / 2 + k * Math.PI / 5;
        points.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      star.poly(points).fill(i < machine.level ? 0xf2b705 : 0xe6dccb).stroke({ color: DIALOG_COLORS.ink, width: 3 });
      star.position.set(this.width / 2 + (i - (machine.maxLevel - 1) / 2) * 84, 150);
      stars.addChild(star);
    }
    this.content.addChild(stars);
    this.text(machine.level === 0 ? 'Estrutura em montagem' : `Nível ${machine.level} de ${machine.maxLevel}`, this.width / 2, 196, 30, DIALOG_COLORS.ink);
    this.text(machineStatus(machine, this.options.serverNow(), rules), this.width / 2, 244, 24, DIALOG_COLORS.ink, { weight: '600', wrap: this.width - 160 });
    // Parts toward the next level.
    if (machine.partsNeeded > 0) {
      const bar = new Graphics();
      const width = 640, x = (this.width - width) / 2, y = 304;
      bar.roundRect(x, y, width, 34, 17).fill(0xefe6d6).stroke({ color: DIALOG_COLORS.frame, width: 3 });
      const share = Math.min(1, machine.parts / machine.partsNeeded);
      if (share > 0) bar.roundRect(x + 4, y + 4, (width - 8) * share, 26, 13).fill(0x4f8fd6);
      bar.label = 'machine-parts-bar';
      this.content.addChild(bar);
      const next = machine.level === 0 ? 'montar' : `o nível ${machine.level + 1}`;
      const coins = machine.nextCoins > 0 ? ` + ${machine.nextCoins.toLocaleString('pt-BR')} moedas` : '';
      this.text(`Peças para ${next}: ${machine.parts}/${machine.partsNeeded}${coins} · Você tem ${this.options.parts()} peça(s)`, this.width / 2, 352, 22, DIALOG_COLORS.ink, { weight: '600' });
    } else {
      this.text('Nível máximo.', this.width / 2, 330, 24, DIALOG_COLORS.gold);
    }
    if (machine.level > 0) {
      this.text(`Cada rodada (${Math.round(rules.runSeconds / 60)} min): ${machine.runCoins} moedas, ${machine.runXp} XP e clientes ${machine.patiencePercent}% mais pacientes. Manutenção a cada ${rules.maintenanceRuns} rodadas.`,
        this.width / 2, 400, 21, DIALOG_COLORS.cash, { weight: '600', wrap: this.width - 160 });
    }
    const buttons: Array<{ action: MachineAction; caption: string; color: number; enabled: boolean }> = [];
    const canInstall = machine.partsNeeded > 0 && (machine.state === 'assembling' || machine.state === 'idle');
    if (canInstall) buttons.push({ action: 'install', caption: 'Instalar peça', color: 0x4f8fd6, enabled: this.options.parts() > 0 });
    if (machine.state === 'idle') buttons.push({ action: 'start', caption: `Ligar · −${rules.startEnergy} energia`, color: DIALOG_COLORS.green, enabled: this.options.energy() >= rules.startEnergy });
    if (machine.state === 'ready') buttons.push({ action: 'collect', caption: `Coletar · +${machine.runCoins} moedas`, color: DIALOG_COLORS.gold, enabled: true });
    if (machine.state === 'broken') buttons.push({ action: 'repair', caption: `Consertar · −${rules.repairEnergy} energia`, color: DIALOG_COLORS.red, enabled: this.options.energy() >= rules.repairEnergy });
    const width = 300, gap = 30, total = buttons.length * width + (buttons.length - 1) * gap;
    buttons.forEach((spec, index) => this.button({
      label: `machine-${spec.action}`, caption: this.busy ? '…' : spec.caption, color: spec.color, width,
      enabled: spec.enabled && !this.busy, onTap: () => this.act(spec.action),
    }, (this.width - total) / 2 + index * (width + gap), 480));
    if (this.message) this.text(this.message, this.width / 2, this.height - 90, 22, this.messageError ? DIALOG_COLORS.red : DIALOG_COLORS.green, { weight: '600', wrap: this.width - 160 });
    this.closeButton('machine-close');
  }

  private act(action: MachineAction): void {
    const machine = this.machine;
    if (!machine || this.busy) return;
    this.busy = true;
    this.message = '';
    this.render();
    this.options.onAction(action, machine.unitId).then((result) => {
      this.busy = false;
      this.machine = result.machines.find((entry) => entry.unitId === machine.unitId) ?? machine;
      this.message = { install: 'Peça instalada.', start: 'Ligada! Os clientes vão esperar com mais paciência.', collect: `+${result.coins ?? 0} moedas e +${result.xp ?? 0} XP.`, repair: 'Consertada.' }[action];
      this.messageError = false;
      this.options.onDone(result, action);
      this.render();
      this.options.audio?.play(action === 'collect' ? 'coin' : 'click');
    }, (error: unknown) => {
      this.busy = false;
      this.message = error instanceof Error ? error.message : 'Não foi possível concluir.';
      this.messageError = true;
      this.render();
      this.options.audio?.play('buzzer');
    });
  }
}

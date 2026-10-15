import { Container, Graphics } from 'pixi.js';

import type { SoundPlayer } from '../../audio/sound-events';
import {
  achievementStep, missionProgress, rewardLine, TIER_COLORS, TIER_NAMES,
  type Achievement, type Mission, type ProgressClaim, type ProgressSnapshot,
} from '../../game/progress';
import { untilText } from '../../game/rewards';
import { DIALOG_COLORS, RoomDialog } from './RoomDialog';

type Tab = 'achievements' | 'missions';

const CARD_WIDTH = 440;
const CARD_HEIGHT = 196;
const CARD_GAP = 20;
const COLUMNS = 3;
const ROWS = 3;
const MISSION_HEIGHT = 170;

/**
 * Troféu: the café's achievements (tiers Bronze → Ouro, or the config's five)
 * and today's three missions. Resgatar asks the server, which checks the goal
 * and credits the reward once.
 */
export class AchievementsModal extends RoomDialog {
  private progress?: ProgressSnapshot;
  private tab: Tab = 'achievements';
  private page = 0;
  private claiming?: string;
  private message = '';

  constructor(private readonly options: {
    onClaim: (kind: 'achievement' | 'mission', id: string) => Promise<ProgressClaim>;
    onClaimed: (claim: ProgressClaim) => void;
    now?: () => number;
    audio?: SoundPlayer;
  }) {
    super('achievements-modal', 1500, 940, options.audio);
  }

  show(progress: ProgressSnapshot, tab?: Tab): void {
    this.progress = progress;
    // Open where a reward waits: missions first if only they have one.
    this.tab = tab ?? (progress.achievements.some((a) => a.claimable) || !progress.missions.some((m) => m.complete && !m.claimed) ? 'achievements' : 'missions');
    this.page = 0;
    this.message = '';
    this.render();
    this.reveal();
  }

  /** New numbers while the window is open (a payment, a cleaned table). */
  refresh(progress: ProgressSnapshot): void {
    this.progress = progress;
    if (this.isOpen && !this.claiming) this.render();
  }

  private render(): void {
    const progress = this.progress;
    if (!progress) return;
    this.clear();
    this.text('Conquistas', this.width / 2, 36, 64, DIALOG_COLORS.title);
    const readyAchievements = progress.achievements.filter((a) => a.claimable).length;
    const readyMissions = progress.missions.filter((m) => m.complete && !m.claimed).length;
    this.tabButton('achievements', 'Conquistas', readyAchievements, this.width / 2 - 330);
    this.tabButton('missions', 'Missões diárias', readyMissions, this.width / 2 + 20);
    if (this.tab === 'achievements') this.renderAchievements(progress.achievements);
    else this.renderMissions(progress);
    if (this.message) this.text(this.message, this.width / 2, this.height - 64, 24, DIALOG_COLORS.red, { weight: '600' });
    this.closeButton('achievements-close');
  }

  private tabButton(tab: Tab, caption: string, ready: number, x: number): void {
    const active = this.tab === tab;
    const button = this.button({
      label: `achievements-tab-${tab}`, caption, color: active ? DIALOG_COLORS.title : DIALOG_COLORS.frame, width: 310,
      onTap: () => { this.tab = tab; this.page = 0; this.message = ''; this.render(); },
    }, x, 124, 60);
    if (ready > 0) {
      const badge = new Container();
      badge.label = `achievements-tab-${tab}-badge`;
      badge.addChild(new Graphics().circle(0, 0, 18).fill(DIALOG_COLORS.red).stroke({ color: 0xffffff, width: 3 }));
      const label = this.text(String(ready), 0, -14, 22, 0xffffff);
      this.content.removeChild(label);
      badge.addChild(label);
      // Top-right corner of the tab (the button is drawn from 0 to its width).
      badge.position.set(300, 6);
      button.addChild(badge);
    }
  }

  private renderAchievements(list: Achievement[]): void {
    const perPage = COLUMNS * ROWS;
    const pages = Math.max(1, Math.ceil(list.length / perPage));
    this.page = Math.min(this.page, pages - 1);
    const total = COLUMNS * CARD_WIDTH + (COLUMNS - 1) * CARD_GAP;
    list.slice(this.page * perPage, (this.page + 1) * perPage).forEach((achievement, index) => {
      const x = (this.width - total) / 2 + (index % COLUMNS) * (CARD_WIDTH + CARD_GAP);
      const y = 214 + Math.floor(index / COLUMNS) * (CARD_HEIGHT + CARD_GAP);
      this.achievementCard(achievement, x, y);
    });
    if (pages > 1) {
      this.text(`${this.page + 1}/${pages}`, this.width / 2, this.height - 112, 24, DIALOG_COLORS.ink);
      if (this.page > 0) this.button({ label: 'achievements-previous', caption: '‹', color: DIALOG_COLORS.frame, width: 64, onTap: () => { this.page--; this.render(); } }, this.width / 2 - 130, this.height - 124, 52);
      if (this.page < pages - 1) this.button({ label: 'achievements-next', caption: '›', color: DIALOG_COLORS.frame, width: 64, onTap: () => { this.page++; this.render(); } }, this.width / 2 + 66, this.height - 124, 52);
    }
  }

  /** The medal of the highest tier claimed; grey before the first. */
  private medal(x: number, y: number, claimed: number): void {
    const medal = new Graphics();
    medal.position.set(x, y);
    medal.moveTo(-14, -40).lineTo(-6, -18).lineTo(6, -18).lineTo(14, -40).fill(0xc0392b);
    medal.circle(0, 0, 26).fill(claimed > 0 ? TIER_COLORS[Math.min(claimed, TIER_COLORS.length) - 1]! : 0xd9cfc0).stroke({ color: DIALOG_COLORS.ink, width: 3 });
    medal.star(0, 0, 5, 12, 6).fill(0xffffff);
    medal.eventMode = 'none';
    this.content.addChild(medal);
  }

  private achievementCard(achievement: Achievement, x: number, y: number): void {
    const step = achievementStep(achievement);
    const card = new Container();
    card.label = `achievement-${achievement.id}`;
    card.position.set(x, y);
    card.addChild(new Graphics().roundRect(0, 0, CARD_WIDTH, CARD_HEIGHT, 18)
      .fill(achievement.claimable ? 0xfff0b3 : step.done ? 0xe8f4e3 : 0xffffff)
      .stroke({ color: achievement.claimable ? DIALOG_COLORS.gold : DIALOG_COLORS.frame, width: achievement.claimable ? 5 : 3 }));
    this.content.addChild(card);
    this.medal(x + 48, y + 66, achievement.claimed);
    const tierName = TIER_NAMES[Math.min(step.tier, TIER_NAMES.length - 1)];
    this.text(achievement.name, x + 92, y + 12, 26, DIALOG_COLORS.ink, { anchorX: 0, align: 'left', wrap: CARD_WIDTH - 104 });
    this.text(step.done ? 'Todos os níveis concluídos' : `${tierName} · ${achievement.description}`, x + 92, y + 46, 18, DIALOG_COLORS.ink,
      { anchorX: 0, align: 'left', wrap: CARD_WIDTH - 104, weight: '600' });
    // Progress bar towards the current tier.
    const bar = new Graphics();
    bar.position.set(x + 92, y + 104);
    const width = CARD_WIDTH - 116;
    bar.roundRect(0, 0, width, 18, 9).fill(0xefe6d8).stroke({ color: DIALOG_COLORS.frame, width: 2 });
    if (step.fraction > 0) bar.roundRect(2, 2, Math.max(14, (width - 4) * step.fraction), 14, 7).fill(step.done ? DIALOG_COLORS.cash : DIALOG_COLORS.gold);
    bar.eventMode = 'none';
    this.content.addChild(bar);
    const shown = Math.min(achievement.progress, step.target);
    this.text(step.done ? achievement.progress.toLocaleString('pt-BR') : `${shown.toLocaleString('pt-BR')}/${step.target.toLocaleString('pt-BR')}`,
      x + 92 + width / 2, y + 100, 17, DIALOG_COLORS.ink);
    const goal = achievement.goals[step.tier];
    if (!step.done && goal) this.text(rewardLine(goal), x + 20, y + CARD_HEIGHT - 60, 18, goal.cash > 0 ? DIALOG_COLORS.cash : DIALOG_COLORS.gold, { anchorX: 0, align: 'left', wrap: 230 });
    const busy = this.claiming === `achievement:${achievement.id}`;
    if (!step.done) {
      this.button({
        label: `achievement-claim-${achievement.id}`, caption: busy ? 'Resgatando…' : 'Resgatar',
        color: DIALOG_COLORS.green, width: 170, enabled: achievement.claimable && !this.claiming,
        onTap: () => this.claim('achievement', achievement.id),
      }, x + CARD_WIDTH - 188, y + CARD_HEIGHT - 66, 52);
    }
  }

  private renderMissions(progress: ProgressSnapshot): void {
    const remaining = progress.nextAt - (this.options.now?.() ?? Date.now());
    this.text(`Três missões por dia; novas ${untilText(remaining)} (meia-noite de São Paulo). Pratos contam ao chegar no balcão.`,
      this.width / 2, 196, 22, DIALOG_COLORS.ink, { weight: '600', wrap: this.width - 160 });
    // Grana only for completing the trio: its line says how far the day's three are.
    const trio = progress.trioCash ?? 0;
    if (trio > 0) {
      const claimed = progress.missions.filter((mission) => mission.claimed).length;
      const label = progress.trioClaimed ? `✓ Trio do dia completo: +${trio} Grana resgatada` : `Complete as três missões: +${trio} Grana na última (${claimed}/${progress.missions.length})`;
      this.text(label, this.width / 2, 232, 22, progress.trioClaimed ? DIALOG_COLORS.cash : DIALOG_COLORS.gold, { weight: '700' });
    }
    progress.missions.forEach((mission, index) => this.missionCard(mission, 270 + index * (MISSION_HEIGHT + 24)));
  }

  private missionCard(mission: Mission, y: number): void {
    const x = 100;
    const width = this.width - 200;
    const ready = mission.complete && !mission.claimed;
    const card = new Container();
    card.label = `mission-${mission.id}`;
    card.position.set(x, y);
    card.addChild(new Graphics().roundRect(0, 0, width, MISSION_HEIGHT, 20)
      .fill(ready ? 0xfff0b3 : mission.claimed ? 0xe8f4e3 : 0xffffff)
      .stroke({ color: ready ? DIALOG_COLORS.gold : DIALOG_COLORS.frame, width: ready ? 5 : 3 }));
    this.content.addChild(card);
    const check = new Graphics();
    check.position.set(x + 70, y + MISSION_HEIGHT / 2);
    check.circle(0, 0, 36).fill(mission.claimed ? DIALOG_COLORS.cash : mission.complete ? DIALOG_COLORS.gold : 0xefe6d8).stroke({ color: DIALOG_COLORS.ink, width: 3 });
    if (mission.complete) check.moveTo(-16, 0).lineTo(-4, 13).lineTo(18, -12).stroke({ color: 0xffffff, width: 7, cap: 'round', join: 'round' });
    check.eventMode = 'none';
    this.content.addChild(check);
    this.text(mission.title, x + 140, y + 24, 32, DIALOG_COLORS.ink, { anchorX: 0, align: 'left', wrap: width - 520 });
    this.text(missionProgress(mission), x + 140, y + 74, 26, mission.complete ? DIALOG_COLORS.cash : DIALOG_COLORS.title, { anchorX: 0, align: 'left' });
    this.text(rewardLine(mission), x + 140, y + 112, 22, DIALOG_COLORS.gold, { anchorX: 0, align: 'left', wrap: width - 520 });
    const busy = this.claiming === `mission:${mission.id}`;
    this.button({
      label: `mission-claim-${mission.id}`, caption: mission.claimed ? 'Resgatada' : busy ? 'Resgatando…' : 'Resgatar',
      color: DIALOG_COLORS.green, width: 260, enabled: ready && !this.claiming,
      onTap: () => this.claim('mission', mission.id),
    }, x + width - 300, y + (MISSION_HEIGHT - 72) / 2, 72);
  }

  private claim(kind: 'achievement' | 'mission', id: string): void {
    if (this.claiming) return;
    this.claiming = `${kind}:${id}`;
    this.message = '';
    this.render();
    this.options.onClaim(kind, id).then((claim) => {
      this.claiming = undefined;
      this.progress = claim.progress;
      this.render();
      this.options.audio?.play('coin');
      this.options.onClaimed(claim);
    }, (error: unknown) => {
      this.claiming = undefined;
      this.message = error instanceof Error ? error.message : 'Não foi possível resgatar o prêmio.';
      this.render();
      this.options.audio?.play('buzzer');
    });
  }
}

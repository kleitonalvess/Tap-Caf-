import { Container, Graphics, Text } from 'pixi.js';

import { FONT_FAMILY } from '../../core/fonts';
import type { MachineView } from '../../game/machines';

/**
 * The badge over an entertainment machine, from its state at the server's
 * now: a wrench while it is being built, music notes while it runs, a coin
 * when the run is ready to collect and smoke when it broke.
 */
export class MachineEffects {
  readonly view = new Container();
  private readonly badge = new Graphics();
  private readonly glyph = new Text({ text: '', style: { fontFamily: FONT_FAMILY, fontSize: 26, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0x3a2412, width: 4 } } });
  private readonly notes: Text[] = [];
  private state: MachineView['state'] | undefined;
  private elapsed = 0;

  constructor() {
    this.view.label = 'machine-effects';
    this.view.eventMode = 'none';
    this.glyph.anchor.set(0.5);
    this.view.addChild(this.badge, this.glyph);
    for (let i = 0; i < 3; i++) {
      const note = new Text({ text: i % 2 ? '♫' : '♪', style: { fontFamily: FONT_FAMILY, fontSize: 24, fontWeight: 'bold', fill: [0xff6fb5, 0x6fd3ff, 0xffd166][i]!, stroke: { color: 0x3a2412, width: 3 } } });
      note.anchor.set(0.5);
      this.notes.push(note);
      this.view.addChild(note);
    }
  }

  set(state: MachineView['state'] | undefined): void {
    if (state === this.state) return;
    this.state = state;
    this.badge.clear();
    this.glyph.text = '';
    this.view.label = `machine-effects-${state ?? 'none'}`;
    const pill = (color: number) => this.badge.circle(0, 0, 20).fill(color).stroke({ color: 0x3a2412, width: 3 });
    switch (state) {
      case 'assembling': pill(0x4f8fd6); this.glyph.text = '🔧'; break;
      case 'ready': pill(0xf2b705); this.glyph.text = '$'; break;
      case 'broken': pill(0xc0392b); this.glyph.text = '!'; break;
    }
    this.notes.forEach((note) => { note.visible = state === 'running'; });
  }

  update(deltaMs: number): void {
    this.elapsed += deltaMs;
    const t = this.elapsed / 1000;
    if (this.state === 'running') {
      this.notes.forEach((note, i) => {
        const phase = (t * 0.6 + i / 3) % 1;
        note.position.set(Math.sin((phase + i) * Math.PI * 2) * 14 + (i - 1) * 16, -phase * 46);
        note.alpha = 1 - phase;
      });
    } else if (this.state) {
      // The badge bobs so a waiting machine catches the eye.
      const bob = Math.sin(t * 4) * 4;
      this.badge.position.y = bob;
      this.glyph.position.y = bob;
    }
  }

  destroy(): void { this.view.destroy({ children: true }); }
}

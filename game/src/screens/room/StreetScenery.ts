import { Assets, Container, Graphics, Polygon, Sprite, Text, TextStyle, type Texture } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';
import { POPUP_DRAW_PRIORITY, itemDepth } from '../../world/iso';
import { groundScreenRange } from '../../world/RoomDepth';
import {
  STREET_BUILDINGS, buildingOutline, footprintCorners, type StreetBuildingDef,
} from '../../world/street-scenery';
import { setRoomDepth } from './RoomDepthSorter';
import { beamTexture, paintStreetBuilding, sparkleTexture, wheelTexture, type StreetArt } from './street-art';

export interface StreetSceneryOptions {
  /** The room world: buildings join the depth sorter like furniture. */
  world: Container;
  /** Shares the room gestures (pan, zoom) and calls onTap only for a real tap. */
  bindGestures: (target: Container, onTap: () => void) => void;
  onTap?: (def: StreetBuildingDef) => void;
}

interface Animated {
  update(seconds: number): void;
}

interface BuildingView {
  def: StreetBuildingDef;
  view: Container;
  /** Art holder scaled around the ground centre for the tap bounce. */
  body: Container;
  animated: Animated[];
  label: Container;
  title: Text;
  caption: Text;
  card: Graphics;
  /** "!" bubble over the roof while the building has something to collect. */
  badge: Container;
  ready: boolean;
  labelTimer: number;
  hovered: boolean;
  bounce: number;
}

const LABEL_SECONDS = 2.6;

/**
 * Street buildings beyond the café: procedural art by default, a processed PNG
 * when the manifest names one. Hover or tap shows the name card; `onTap` is the
 * hook for the screens these buildings will open.
 */
export class StreetScenery {
  private readonly buildings: BuildingView[] = [];
  private readonly shared: Texture[] = [];
  private elapsed = 0;
  private destroyed = false;
  /** 0 = calm street, 1 = party at the disco (beams speed up and brighten). */
  private party = 0;
  private partyTarget = 0;

  constructor(private readonly options: StreetSceneryOptions, defs: readonly StreetBuildingDef[] = STREET_BUILDINGS) {
    for (const def of defs) this.buildings.push(this.create(def));
  }

  private create(def: StreetBuildingDef): BuildingView {
    const corners = footprintCorners(def);
    const view = new Container();
    view.label = `street-building:${def.id}`;
    view.position.set(corners.back.x, corners.back.y);
    view.eventMode = 'static';
    view.cursor = 'pointer';
    view.hitArea = new Polygon(buildingOutline(def).flatMap((point) => [point.x - corners.back.x, point.y - corners.back.y]));

    const points = [
      { x: def.tx, y: def.ty }, { x: def.tx + def.sizeX, y: def.ty },
      { x: def.tx + def.sizeX, y: def.ty + def.sizeY }, { x: def.tx, y: def.ty + def.sizeY },
    ];
    setRoomDepth(view, {
      points, depth: itemDepth(def.tx + def.sizeX - 1, def.ty + def.sizeY - 1), ...groundScreenRange(points),
    });

    const body = new Container();
    const ground = { x: (corners.left.x + corners.right.x) / 2 - corners.back.x, y: (corners.back.y + corners.front.y) / 2 - corners.back.y };
    body.pivot.set(ground.x, ground.y);
    body.position.set(ground.x, ground.y);
    view.addChild(body);
    const animated: Animated[] = [];
    if (def.image) {
      const sprite = new Sprite();
      sprite.position.set(def.image.left, def.image.top);
      body.addChild(sprite);
      void Assets.load<Texture>(def.image.file).then((texture) => {
        if (!this.destroyed) sprite.texture = texture;
      }).catch((error: unknown) => console.warn('[street] arte indisponível', def.id, error));
    } else {
      const art = paintStreetBuilding(def);
      this.shared.push(art.base, ...(art.glow ? [art.glow] : []));
      const base = new Sprite(art.base);
      base.position.set(art.frame.left, art.frame.top);
      body.addChild(base);
      animated.push(...this.addEffects(body, art));
    }

    const { label, title, caption, card } = this.createLabel(def);
    const top = Math.min(...buildingOutline(def).map((point) => point.y));
    label.position.set((corners.left.x + corners.right.x) / 2, top - 18);
    label.visible = false;
    label.zIndex = POPUP_DRAW_PRIORITY + 2;
    const badge = this.createBadge();
    badge.position.set((corners.left.x + corners.right.x) / 2, top - 30);
    badge.visible = false;
    badge.zIndex = POPUP_DRAW_PRIORITY + 1;

    const building: BuildingView = { def, view, body, animated, label, title, caption, card, badge, ready: false, labelTimer: 0, hovered: false, bounce: 0 };
    view.on('pointerover', () => { building.hovered = true; });
    view.on('pointerout', () => { building.hovered = false; });
    this.options.bindGestures(view, () => this.tap(building));
    this.options.world.addChild(view, badge, label);
    return building;
  }

  private addEffects(view: Container, art: StreetArt): Animated[] {
    const animated: Animated[] = [];
    if (art.glow) {
      const glow = new Sprite(art.glow);
      glow.position.set(art.frame.left, art.frame.top);
      glow.blendMode = 'add';
      glow.eventMode = 'none';
      view.addChild(glow);
      // Slow breathing, like a neon tube warming up.
      animated.push({ update: (t) => { glow.alpha = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2.4)); } });
    }
    for (const prop of art.props) {
      if (prop.kind === 'beam') {
        const beam = new Sprite(this.sharedTexture('beam', beamTexture));
        beam.anchor.set(0.5, 1);
        beam.position.set(prop.x, prop.y);
        beam.tint = prop.color;
        beam.blendMode = 'add';
        beam.alpha = 0.32;
        beam.eventMode = 'none';
        view.addChildAt(beam, 0);
        // During a party the beams sweep faster and wider, and shine brighter.
        animated.push({ update: (t) => {
          beam.rotation = (0.42 + 0.3 * this.party) * Math.sin(t * (0.7 + 2.3 * this.party) + prop.phase);
          beam.alpha = 0.32 + 0.4 * this.party;
        } });
      } else if (prop.kind === 'sparkle') {
        const sparkle = new Sprite(this.sharedTexture('sparkle', sparkleTexture));
        sparkle.anchor.set(0.5);
        sparkle.position.set(prop.x, prop.y);
        sparkle.blendMode = 'add';
        sparkle.eventMode = 'none';
        view.addChild(sparkle);
        animated.push({ update: (t) => {
          const pulse = Math.max(0, Math.sin(t * 3.1 + prop.phase));
          sparkle.alpha = pulse;
          sparkle.scale.set(0.4 + 0.6 * pulse);
          sparkle.rotation = t * 0.8;
        } });
      } else {
        // Seen at an angle: the wheel spins inside a squashed holder.
        const holder = new Container();
        holder.position.set(prop.x, prop.y);
        holder.scale.set(0.55, 1);
        holder.eventMode = 'none';
        const wheel = new Sprite(this.sharedTexture(`wheel-${prop.radius}`, () => wheelTexture(prop.radius)));
        wheel.anchor.set(0.5);
        holder.addChild(wheel);
        view.addChild(holder);
        animated.push({ update: (t) => { wheel.rotation = t * 0.9; } });
      }
    }
    return animated;
  }

  private readonly textures = new Map<string, Texture>();

  private sharedTexture(key: string, make: () => Texture): Texture {
    let texture = this.textures.get(key);
    if (!texture) {
      texture = make();
      this.textures.set(key, texture);
      this.shared.push(texture);
    }
    return texture;
  }

  private createLabel(def: StreetBuildingDef): { label: Container; title: Text; caption: Text; card: Graphics } {
    const label = new Container();
    label.label = `street-label:${def.id}`;
    label.eventMode = 'none';
    const title = new Text({
      text: def.name,
      style: new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 42, fontWeight: '700', fill: 0x5a3915 }),
    });
    const caption = new Text({
      text: def.status,
      style: new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 34, fontWeight: '700', fill: 0xd2541b }),
    });
    caption.label = `street-caption:${def.id}`;
    title.anchor.set(0.5, 0);
    caption.anchor.set(0.5, 0);
    const card = new Graphics();
    label.addChild(card, title, caption);
    this.layoutLabel(title, caption, card);
    return { label, title, caption, card };
  }

  /** The card fits its two lines; it is redrawn when the second line changes. */
  private layoutLabel(title: Text, caption: Text, card: Graphics): void {
    const width = Math.max(title.width, caption.width) + 44;
    const height = title.height + caption.height + 22;
    title.position.set(0, -height + 9);
    caption.position.set(0, -height + 11 + title.height);
    card.clear()
      .roundRect(-width / 2, -height, width, height, 18).fill(0xfff7e6).stroke({ color: 0x5a3915, width: 4 })
      .moveTo(-14, -2).lineTo(0, 16).lineTo(14, -2).closePath().fill(0xfff7e6);
    card.moveTo(-14, 0).lineTo(0, 16).lineTo(14, 0).stroke({ color: 0x5a3915, width: 4 });
  }

  private createBadge(): Container {
    const badge = new Container();
    badge.label = 'street-ready-badge';
    badge.eventMode = 'none';
    const bubble = new Graphics()
      .circle(0, 0, 30).fill(0xffd23f).stroke({ color: 0x5a3915, width: 5 })
      .moveTo(-10, 24).lineTo(0, 44).lineTo(10, 24).closePath().fill(0xffd23f);
    const mark = new Text({
      text: '!',
      style: new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 44, fontWeight: '700', fill: 0x5a3915 }),
    });
    mark.anchor.set(0.5);
    badge.addChild(bubble, mark);
    return badge;
  }

  /** Second line of a building's card, and whether it has something to collect or start. */
  setStatus(id: string, caption: string, ready: boolean): void {
    const building = this.buildings.find((candidate) => candidate.def.id === id);
    if (!building) return;
    building.ready = ready;
    if (building.caption.text === caption) return;
    building.caption.text = caption;
    this.layoutLabel(building.title, building.caption, building.card);
  }

  /** The disco's beams follow the party, easing in and out. */
  setParty(active: boolean): void {
    this.partyTarget = active ? 1 : 0;
  }

  private tap(building: BuildingView): void {
    building.labelTimer = LABEL_SECONDS;
    building.bounce = 1;
    this.options.onTap?.(building.def);
  }

  /** Shows the teaser card above a building, as a tap does. */
  showTeaser(id: string): void {
    const building = this.buildings.find((candidate) => candidate.def.id === id);
    if (building) this.tap(building);
  }

  update(deltaMs: number): void {
    const seconds = Math.max(0, deltaMs) / 1000;
    this.elapsed += seconds;
    this.party += (this.partyTarget - this.party) * Math.min(1, seconds * 2);
    for (const building of this.buildings) {
      // The "!" bobs while the building waits for the owner, hidden while its card is up.
      building.badge.visible = building.ready && building.label.visible === false;
      if (building.badge.visible) building.badge.pivot.y = 8 * Math.abs(Math.sin(this.elapsed * 3));
      for (const item of building.animated) item.update(this.elapsed);
      building.labelTimer = Math.max(0, building.labelTimer - seconds);
      const showing = building.hovered || building.labelTimer > 0;
      building.label.visible = showing;
      if (showing) {
        const fade = building.hovered ? 1 : Math.min(1, building.labelTimer / 0.4);
        building.label.alpha = fade;
      }
      // A tap squashes and releases the building, and the card pops with it.
      building.bounce = Math.max(0, building.bounce - seconds * 3.2);
      const squash = Math.sin(building.bounce * Math.PI) * 0.035 * building.bounce;
      building.body.scale.set(1 + squash, 1 - squash);
      building.label.scale.set(1 + squash * 3);
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const building of this.buildings) {
      building.view.destroy({ children: true });
      building.label.destroy({ children: true });
      building.badge.destroy({ children: true });
    }
    this.buildings.length = 0;
    for (const texture of this.shared) texture.destroy(true);
    this.shared.length = 0;
    this.textures.clear();
  }
}

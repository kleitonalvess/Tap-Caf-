import { GAME_VERSION } from '../../core/version';
import {
  Container,
  Graphics,
  Polygon,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
  type FederatedPointerEvent,
  type FederatedWheelEvent,
} from 'pixi.js';

import { FONT_FAMILY } from '../../core/fonts';
import type { SoundPlayer } from '../../audio/sound-events';
import { AudioHudControl, type AudioHudControlOptions } from '../../ui/AudioHudControl';
import type { Screen } from '../../core/screen-manager';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../core/stage';
import { Actor } from '../../world/Actor';
import { CLIP } from '../../avatar/clips';
import { type ActionBarButtonTextures, type ActionBarIconTexture, type NpcEmotionTextures, type StoreToolbarTextures } from '../../game/asset-manifest';
import { ActionBarMood } from './ActionBarMood';
import { createActionBarBetaSlots } from './ActionBarBetaSlots';
import { MAIN_ACTION_BAR_SCALE, StoreActionBar } from './StoreActionBar';
import { RoomStoreController } from './RoomStoreController';
import { roomModelItems, type RoomSnapshot, type RoomInventoryClient } from '../../game/room-inventory';
import { RoomRealtime, type RoomEvent, type SharedActor, type SharedDirt, type SharedFood, type SharedPayment, type SharedWorld } from '../../game/room-realtime';
import { cleanTable } from '../../game/tables';
import { WardrobeScreenModal, type WardrobeScreenTextures } from './WardrobeScreenModal';
import { SettingsModal, type SettingsModalOptions } from '../../ui/SettingsModal';
import { findPath } from '../../world/PathFinder';
import { RoomModel, footprintTiles, type RoomItem } from '../../world/RoomModel';
import {
  CookScreenModal,
  type CookRecipeEvent,
  type CookScreenTextures,
} from './CookScreenModal';
import { CookProgressBar } from './CookProgressBar';
import { CookProgressCallout } from './CookProgressCallout';
import { DoorView } from './DoorView';
import { doorOpeningTile } from '../../world/doorGeometry';
import { StoveActionMenu, type StoveAction } from './StoveActionMenu';
import { StoveEffects } from './StoveEffects';
import { CounterDish } from './CounterDish';
import { PatienceMeter, fetchProgress, patienceLeft } from './PatienceMeter';
import { ExpansionModal } from './ExpansionModal';
import { ExpansionGlow, newFloorTiles } from './ExpansionGlow';
import { ExpansionClient, sizeLabel, type ExpansionResult } from '../../game/expansion';
import { StreetModal, type StreetBuildingId } from './StreetModal';
import { PartyBadge, PartyLights } from './PartyLights';
import { StreetClient, farmCaption, farmStatus, formatClock, partyCaption, partyStatus, type StreetState } from '../../game/street';
import { FESTA_DO_BAIRRO } from '../../audio/music';
import { WelcomeBackModal } from './WelcomeBackModal';
import { ConfirmDialog } from './ConfirmDialog';
import { DailyBonusModal } from './DailyBonusModal';
import { MailModal } from './MailModal';
import { claimDaily, claimLetter, loadDaily, loadMail, type DailyState } from '../../game/rewards';
import { isOffline } from '../../game/backend';
import { acknowledgeAway, awayAddition, type AwaySummary } from '../../game/away';
import type { MusicTrack } from '../../audio/AudioEngine';
import { RecipeArtLibrary } from '../../game/recipe-art';
import type { GameRules } from '../../game/game-rules';
import {
  DEPTH_BIAS_ITEM,
  DEPTH_BIAS_WALL_DECOR,
  FLOOR_DRAW_PRIORITY,
  POPUP_DRAW_PRIORITY,
  ROOM_ASSET_SCALE,
  directionFromDelta,
  itemDepth,
  screenToTile,
  tileToScreenX,
  tileToScreenY,
  type Tile,
} from '../../world/iso';
import { CLEANER_CLIPS, PLAYER_ROOM_CLIPS, ROOM_CLIPS, WAITER_CLIPS, bakeAvatars, type AvatarAtlasBundle, type BakedAvatarBundle } from '../../avatar/bake';
import { restoreAppearance } from '../../avatar/appearance';
import { NpcLookPicker } from '../../avatar/NpcLookPicker';
import { releaseNpcAvatar, type NpcAvatarSource } from '../../avatar/NpcAvatarSource';
import { loadAvatarAssets } from '../../game/asset-manifest';
import { saveAppearance } from '../../game/appearance';
import { rotatedArt, type ArtProvider } from '../../game/indoor-art';
import { ActorView } from './ActorView';
import { AvatarActorView } from './AvatarActorView';
import { NpcEmotion } from './NpcEmotion';
import { RoomDepthSorter, setItemOverlayDepth } from './RoomDepthSorter';
import { StreetScenery } from './StreetScenery';
import { TableDirt } from './TableDirt';
import { StaffModal } from './StaffModal';
import { LevelUpModal } from './LevelUpModal';
import { levelUnlocks, nextUnlocks } from '../../game/game-rules';
import { StaffClient } from '../../game/staff';
import { OutsideNpcManager, type PreparedNpcView } from './OutsideNpcManager';
import { createProceduralWallView, type WallWallpaper } from './ProceduralWallView';
import { TOP_BAR_ICON_FRAMES, TopBars, type TopBarsTextures } from './TopBars';
import { FloatingRewards, LevelUpToast } from './FloatingRewards';
import type { PlayerState } from '../../game/player-state';
import { cancelRefund, cookingTime, staleness, stoveStatus, type CookingClient, type CookingSnapshot, type StoveCooking, type StoveStatus } from '../../game/cooking';
import {
  PAN_KEY_STEP,
  RoomCamera,
  ZOOM_KEY_STEP,
  ZOOM_WHEEL_STEP,
  type CameraRect,
} from './RoomCamera';
import {
  TEST_GRID,
  createArtView,
  createFloorViews,
  createItemViews,
  createSceneBackgroundView,
  drawFloor,
  drawTestGrid,
  tileDiamond,
  rotateFloorSprite,
} from './iso-art';

/** Altura máxima de móvel, usada para enquadrar a câmera. */
const MAX_ITEM_HEIGHT = 150 * ROOM_ASSET_SCALE;

/** Folga em volta da sala, para ela não encostar na borda da tela. */
const CAMERA_PADDING = 60 * ROOM_ASSET_SCALE;

/** Tray position relative to a waiter's feet (world px), tuned on the WAITOR_WALK frames. */
const TRAY_OFFSET_X = 22;
const TRAY_HEIGHT = 92;
const TRAY_DISH_SIZE = 54;

/** Mantém as bordas laterais da textura longe do pan habitual. */
const SCENE_CAMERA_INSET = 900;

/**
 * Acima do café a arte é gramado até a borda; a folga menor deixa a câmera
 * alcançar os prédios da rua (StreetScenery) e seus cartões sob o HUD superior.
 */
const SCENE_CAMERA_TOP_INSET = 150;

/** A diagonal até (25,25) usa apenas o terreno verde contínuo abaixo da arte. */
const SCENE_DIAGONAL_PAN_TILE = 25;
/** Bottom-bar systems not built yet: the toast names each one. */
const SOON_SYSTEMS: Record<string, string> = {
  trophy: 'Conquistas: desafios com prêmio a cada marca alcançada.',
  gift: 'Presentes: troque presentes com os vizinhos todos os dias.',
  'yellow-box': 'Caixas misteriosas: itens surpresa para o seu café.',
  map: 'Mapa do bairro: visite a rua e os cafés vizinhos.',
  mortar: 'Temperos: condimentos especiais que rendem mais porções.',
};
const MOBILE_LANDSCAPE_HUD_SCALE = 1.15;
const ACTION_BAR_UI_SCALE = 1.15;
/** Isolated renderer preview only; gameplay duration always comes from the server. */
const LOCAL_COOKING_PREVIEW_MS = 2000;
/** The daily bonus waits this long for the welcome (and its away summary) before showing anyway. */
const DAILY_WELCOME_WAIT_MS = 15_000;
/** A failed or early daily check asks again after this. */
const DAILY_RETRY_MS = 60_000;
const LOCAL_COOKING_DURATION_MS = 30_000;
const COOKING_PROGRESS_SCALE = 1.2;
const STOVE_MENU_TOP_DROP = 14;
const TARGET_STOVE_ALPHA = 0.38;

/**
 * Quanto o ponteiro pode andar, em px de stage, antes do gesto deixar de ser
 * clique e virar arraste.
 *
 * O botão esquerdo tem dois papéis: andar até o tile e arrastar a câmera. Sem
 * limiar, todo arraste terminaria mandando o jogador andar para onde o dedo
 * soltou. Com limiar, o toque curto continua sendo clique e o movimento longo
 * cancela o clique.
 */
const DRAG_THRESHOLD = 6;

const NPC_COLORS = [0xd8763f, 0x8e5bb5, 0x3f9e8c, 0xc9515f];


/** Pixels que um dente de roda de mouse costuma reportar. */
const WHEEL_PIXELS_PER_NOTCH = 100;

/** Pixels por unidade quando o navegador reporta em linhas ou páginas. */
const WHEEL_LINE_PIXELS = 16;
const WHEEL_PAGE_PIXELS = 100;

/** Teto de passos por evento, para um `deltaY` gigante não pular o zoom inteiro. */
const WHEEL_MAX_NOTCHES = 4;

/**
 * Converte o `deltaY` da roda em passos de zoom, com sinal invertido: girar para
 * cima aproxima.
 *
 * Usar só o SINAL do delta parece suficiente e não é: o trackpad manda muitos
 * eventos pequenos, o mouse manda um de ~100 por dente, e um evento sintético
 * pode trazer 3000 de uma vez. Contar em dentes trata os três casos com a mesma
 * conta, e o teto evita que um delta enorme atravesse a faixa de zoom inteira.
 */
export function wheelNotches(deltaY: number, deltaMode = 0): number {
  const escala = deltaMode === 1 ? WHEEL_LINE_PIXELS : deltaMode === 2 ? WHEEL_PAGE_PIXELS : 1;
  const dentes = (-deltaY * escala) / WHEEL_PIXELS_PER_NOTCH;
  return Math.max(-WHEEL_MAX_NOTCHES, Math.min(WHEEL_MAX_NOTCHES, dentes));
}

interface DragState {
  pointerId: number;
  lastX: number;
  lastY: number;
  /** Distância total percorrida, para comparar com DRAG_THRESHOLD. */
  travelled: number;
}

interface PinchState {
  startDistance: number;
  startZoom: number;
  center: { x: number; y: number };
}

/** Vista procedural ou avatar renderizado a partir do mesmo modelo. */
interface ActorRenderer {
  readonly view: Container;
  sync(): void;
  update?(deltaMs: number): void;
  setActionClip?(clip: number | null, elapsedMs?: number): void;
  setBaseClips?(walk: number, idle: number): void;
  destroy(): void;
}

interface Wanderer {
  actor: Actor;
  view: ActorRenderer;
  idleMs: number;
}

export interface RoomScreenOptions {
  /** Authenticated server snapshot; absent HUDs stay hidden, never simulated. */
  playerState?: PlayerState;
  roomSnapshot?: RoomSnapshot;
  roomClient?: RoomInventoryClient;
  realtime?: RoomRealtime;
  model?: RoomModel;
  /** Quantos NPCs vagam pela sala, além do jogador. */
  npcCount?: number;
  random?: () => number;
  showHud?: boolean;
  /** Arte dos móveis; entradas ausentes usam o desenho procedural de fallback. */
  artProvider?: ArtProvider;
  /** Símbolo do piso. `FloorTile` é o piso de madeira da sala inicial. */
  floorClassName?: string;
  /** Atlas de aparências. O primeiro pertence ao jogador; os demais compõem o conjunto de NPCs em prévias isoladas. */

  avatars?: readonly BakedAvatarBundle[];
  /** Static white silhouette shared while individual appearances load. */
  placeholderAvatar?: AvatarAtlasBundle;
  /** Normal gameplay generates and bakes one new look before each street spawn. */
  npcAvatarSource?: NpcAvatarSource;
  /** Liga os atalhos de teclado da câmera. Desligado nos testes de unidade. */
  keyboardCamera?: boolean;
  /** Spawna pedestres e clientes autônomos na calçada externa. */
  outsideNpcs?: boolean;
  /** Textura da barra de ações da UI do jogo (inferior central). */
  actionBarTexture?: Texture;
  storeBarTexture?: Texture;
  storeBarIcons?: readonly ActionBarIconTexture[];
  storeTopButtonTexture?: Texture;
  storeToolbarTextures?: StoreToolbarTextures;
  actionBarButtons?: ActionBarButtonTextures;
  actionBarIcons?: readonly ActionBarIconTexture[];
  npcEmotionTextures?: NpcEmotionTextures;
  /** Nome autenticado e preferências locais de música/efeitos. */
  settings?: SettingsModalOptions;
  /** Base das barras de progresso no topo da interface. */
  topBarsTextures?: TopBarsTextures;
  /** Texturas da tela de receitas do fogão (cook screen e food card). */
  cookTextures?: CookScreenTextures;
  /** Sessão de preparo e estado durável retornados pelo servidor. */
  cookingClient?: CookingClient;
  cookingSnapshot?: CookingSnapshot;
  wardrobeTextures?: WardrobeScreenTextures;
  onWardrobeVisibilityChange?: (open: boolean) => void;
  /** Sound effects and the rush-hour intensity of procedural music. */
  audio?: SoundPlayer & { setIntensity(value: number): void; setOverride?(track: MusicTrack | null): void };
  /** Top-left mute, track and volume control. */
  audioControl?: AudioHudControlOptions;
  /** Recipes and kitchen rules published by the server. */
  rules?: GameRules;
}

/** Cena isométrica com câmera e HUD independente do zoom. O mundo contém piso, destaques e objetos ordenados por RoomDepthSorter. A hitbox troca de tile na metade do passo; os sprites continuam interpolados. */

export class RoomScreen implements Screen {
  readonly view = new Container();
  readonly model: RoomModel;

  /** Raiz da cena da sala, em coordenadas de tela isométrica. */
  readonly world = new Container();

  /** Câmera: só números. Quem aplica é `cameraLayer`. */
  readonly camera: RoomCamera;

  /** Modal da tela de receitas aberto ao clicar no fogão. */
  readonly cookModal?: CookScreenModal;
  readonly wardrobeModal?: WardrobeScreenModal;
  readonly settingsModal?: SettingsModal;
  private staffModal?: StaffModal;
  private levelUpModal?: LevelUpModal;
  private expansionModal?: ExpansionModal;
  private readonly expansionGlows: ExpansionGlow[] = [];
  /** Farm and disco timers (absolute instants from the server). */
  private street?: StreetState;
  private streetModal?: StreetModal;
  private readonly streetClient = new StreetClient();
  private readonly partyLights = new PartyLights(FLOOR_DRAW_PRIORITY + 2);
  private readonly partyBadge = new PartyBadge();
  private partyOn = false;
  private streetSecond = -1;
  private welcomeBack?: WelcomeBackModal;
  private readonly confirmDialog: ConfirmDialog;
  private dailyModal?: DailyBonusModal;
  private mailModal?: MailModal;
  /** Unclaimed bonus to show once nothing else is open (after the away summary). */
  private pendingDaily?: DailyState;
  /** Next São Paulo midnight (server clock): a long session asks again for the new day's bonus. */
  private dailyNextAt = 0;
  /** The bonus waits for the owner's first welcome, which brings the away summary
   * of a sleeping room; a socket that never connects stops holding it at this instant. */
  private dailyHeldUntil = Date.now() + DAILY_WELCOME_WAIT_MS;
  private welcomed = false;
  private mailBadge?: { view: Container; label: Text };
  /** Absence summary waiting for the other windows to close; `to` of the last one shown. */
  private pendingAway?: AwaySummary;
  private shownAway?: AwaySummary;
  /** Last level celebrated; a level-up shows what opened since then. */
  private knownLevel = 1;
  /** Dishes on the waiters' trays, by actor id. */
  private readonly trayDishes = new Map<string, Sprite>();
  readonly storeBar?: StoreActionBar;

  /** Barras de recursos fora da câmera. */
  readonly topBars?: TopBars;
  private readonly floatingRewards: FloatingRewards;
  private streetScenery?: StreetScenery;
  private readonly levelUpToast = new LevelUpToast();
  private readonly audio?: SoundPlayer & { setIntensity(value: number): void; setOverride?(track: MusicTrack | null): void };
  private readonly audioControl?: AudioHudControl;
  private rushIntensity = -1;
  private stovesUrgent = false;
  private lastDeltaMs = 0;
  private readonly rules?: GameRules;
  private readonly recipeArt: RecipeArtLibrary;
  /** Free recipe offered by the server's emergency help, from the last cooking snapshot. */
  private emergencyRecipeId?: string;
  /** Dishes on counters, as broadcast by the room (complete list per event). */
  private foods: SharedFood[] = [];
  private readonly counterDishes = new Map<string, CounterDish>();
  private readonly stoveEffects = new Map<string, StoveEffects>();
  /** Last status seen per stove in this session, to notice a dish spoiling. */
  private readonly stoveStatuses = new Map<string, StoveStatus>();
  private readonly patienceMeters = new Map<string, PatienceMeter>();

  private readonly cameraLayer = new Container();
  /** Cidade/estrada atrás do quarto, movida e ampliada pela mesma câmera. */
  private readonly sceneArt = new Container();
  /**
   * Alvo de ponteiro do tamanho da stage, atrás de tudo.
   *
   * Existe para o arraste e a roda funcionarem em qualquer lugar da tela, e não
   * só sobre o losango do piso: fora da sala, sobre um móvel ou sobre a parede.
   */
  private readonly backdrop = new Container();
  private readonly floor = new Graphics();
  private readonly floorArt = new Container();
  private readonly testGrid = new Graphics();
  private readonly highlight = new Graphics();
  private readonly target = new Graphics();
  private readonly hud: Text | null = null;
  private fpsElapsedMs = 0;
  private fpsFrames = 0;
  private fps = 0;

  private readonly random: () => number;
  private readonly artProvider?: ArtProvider;
  private readonly cookProgressTextures?: CookScreenTextures;
  private readonly cookingClient?: CookingClient;
  private readonly occupiedStoves = new Map<string, StoveCooking>();
  private checkingCookScreen = false;
  private startingCook = false;
  private cancellingCook = false;
  private destroyed = false;
  private readonly floorClassName: string;
  private roomSnapshot?: RoomSnapshot;
  private roomStore?: RoomStoreController;
  private readonly realtime?: RoomRealtime;
  private readonly liveActors = new Map<string, { actor: Actor; view: ActorRenderer; state: SharedActor; bundle?: BakedAvatarBundle; appearanceRevision: number; appearanceController?: AbortController }>();
  private readonly mealViews = new Map<string, Sprite>();
  /** Plates left on tables (shared state) and their views, by table unit id. */
  private dirt: SharedDirt[] = [];
  private readonly tableDirt = new Map<string, TableDirt>();
  private tableCleaning?: { table: RoomItem; phase: 'walking' | 'requesting' };
  private readonly sharedCookingViews = new Map<string, Sprite>();
  private readonly sharedCookingProgress = new Map<string, { mode: 'cooking' | 'serving'; bar: CookProgressBar }>();
  private readonly liveEmotions = new Map<string, { id: string; effect: NpcEmotion }>();
  private readonly npcEmotionTextures?: NpcEmotionTextures;
  private connectionHint?: Text;
  private networkPending = 0;
  private noticeTimer?: ReturnType<typeof setTimeout>;
  private readonly itemViews = new Map<RoomItem, Container[]>();
  private readonly floorUnitViews = new Map<string, Sprite>();
  private readonly avatars: readonly BakedAvatarBundle[];
  private readonly placeholderAvatar?: AvatarAtlasBundle;
  private readonly npcAvatarSource?: NpcAvatarSource;
  private readonly npcLookPicker: NpcLookPicker;
  private readonly npcAvatarIndices = new Map<Actor, number>();
  private readonly player: Actor;
  private readonly playerView: ActorRenderer;
  private playerAppearance = '';
  private appearanceRevision = 0;
  private appearanceAtlas: BakedAvatarBundle | null = null;
  private readonly wanderers: Wanderer[] = [];
  private readonly outsideNpcManager?: OutsideNpcManager;
  private readonly actionBarMood?: ActionBarMood;
  private readonly actionBarLayer = new Container();
  private readonly actionIconHovers: Array<{ sprite: Sprite; targetY: number }> = [];
  private topBarsBaseWidth = 0;
  private readonly stoveViews = new Map<RoomItem, Array<Sprite | Graphics>>();
  private readonly doorViews: DoorView[] = [];
  private readonly depthSorter = new RoomDepthSorter();
  private selectedStove?: RoomItem;
  private pendingCook?: { stove: RoomItem; recipe: CookRecipeEvent };
  private stoveActions?: StoveActionMenu;
  private stoveActionsStove?: RoomItem;
  private cookCallout?: CookProgressCallout;
  private hoveredStove?: RoomItem;
  private servingProcess?: {
    stove: RoomItem;
    phase: 'walking' | 'requesting' | 'serving' | 'finalizing';
    elapsedMs: number;
    startedAtMs?: number;
    durationMs?: number;
    progress?: CookProgressBar;
  };

  private hovered: Tile | null = null;
  private drag: DragState | null = null;
  private readonly touchPoints = new Map<number, { x: number; y: number }>();
  private pinch: PinchState | null = null;
  /** Ligado quando o arraste passou do limiar: o `pointertap` seguinte é ignorado. */
  private dragCancelledTap = false;
  private pinchCancelledTap = false;
  private readonly keyboardCamera: boolean;
  /** Pixels físicos por pixel de stage. Vem de `setStageScale`. */
  private outerScale = 1;

  /** Processo de cozimento atual no fogão (estágio 1 - ingredientes -> estágio 2 - prato pronto). */
  private cookingProcess?: {
    stove: RoomItem;
    recipeId: string;
    recipeName: string;
    stage: 1 | 2;
    phase: 'walking' | 'preparing' | 'cooking' | 'ready';
    stage1Texture: Texture;
    stage2Texture: Texture;
    elapsedMs: number;
    durationMs: number;
    preparingAtMs?: number;
    startedAtMs?: number;
    readyAtMs?: number;
    placementActive: boolean;
    view: Sprite;
    progress?: CookProgressBar;
  };

  /** Dados do cozimento atual para consulta e testes. */
  get cooking(): { stage: 1 | 2; recipeName: string; view: Sprite } | undefined {
    if (!this.cookingProcess) return undefined;
    return {
      stage: this.cookingProcess.stage,
      recipeName: this.cookingProcess.recipeName,
      view: this.cookingProcess.view,
    };
  }

  constructor(options: RoomScreenOptions = {}) {
    this.model = options.model ?? new RoomModel();
    this.random = options.random ?? Math.random;
    this.artProvider = options.artProvider;
    this.cookProgressTextures = options.cookTextures;
    this.cookingClient = options.cookingClient;
    this.rules = options.rules;
    // Set before any player state arrives, so loading never replays a level-up.
    this.knownLevel = Math.max(1, options.playerState?.level ?? options.roomSnapshot?.playerState?.level ?? 1);
    // Processed PNGs where they exist (only the cake so far); the rest are drawn.
    const images: Record<string, { stage1?: Texture; stage2?: Texture }> = {
      cake_1: { stage1: options.cookTextures?.cakeStage1, stage2: options.cookTextures?.cakeStage2 },
    };
    this.recipeArt = new RecipeArtLibrary(images);
    this.floorClassName = options.floorClassName ?? 'FloorTile';
    this.roomSnapshot = options.roomSnapshot;
    this.realtime = options.realtime;
    this.npcEmotionTextures = options.npcEmotionTextures;
    this.avatars = options.avatars ?? [];
    this.placeholderAvatar = options.placeholderAvatar;
    this.npcAvatarSource = options.npcAvatarSource;
    this.npcLookPicker = new NpcLookPicker(this.avatars.slice(1).map((bundle, offset) => bundle.lookKey ?? `atlas:${offset + 1}`), this.random);
    this.playerAppearance = options.playerState?.appearance ?? '';
    this.keyboardCamera = options.keyboardCamera ?? true;

    this.view.label = 'room-screen';
    this.world.sortableChildren = true;
    this.cameraLayer.label = 'room-camera';
    this.sceneArt.label = 'room-city-layer';

    // hitArea cobre a stage sem criar geometria de fundo.

    this.backdrop.label = 'room-backdrop';
    this.backdrop.eventMode = 'static';
    this.backdrop.hitArea = new Rectangle(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    this.floor.label = 'room-floor';
    this.floor.zIndex = FLOOR_DRAW_PRIORITY;
    this.floor.eventMode = 'static';
    this.floor.cursor = 'pointer';
    this.floor.on('pointermove', this.onPointerMove);
    this.floor.on('pointertap', this.onPointerTap);

    this.floorArt.label = 'room-floor-art';
    this.floorArt.zIndex = FLOOR_DRAW_PRIORITY + 1;
    this.testGrid.label = 'room-test-grid';
    this.testGrid.zIndex = FLOOR_DRAW_PRIORITY - 1;
    this.highlight.zIndex = FLOOR_DRAW_PRIORITY + 2;
    this.target.zIndex = FLOOR_DRAW_PRIORITY + 3;

    this.world.addChild(this.floor, this.floorArt, this.highlight, this.target, this.partyLights.view);
    this.partyLights.setRoom(this.model.tilesX, this.model.tilesY);
    if (options.roomSnapshot?.street) this.street = options.roomSnapshot.street;
    this.buildFloor();
    this.buildSceneBackground();
    drawTestGrid(this.testGrid, this.model);
    for (const item of this.model.items) this.addItem(item);

    const start = this.pickFreeTile({ tx: 4, ty: 4 });
    this.player = new Actor('player');
    this.player.setTilePosition(start.tx, start.ty);
    this.playerView = this.createActorView(this.player, 0, 0x4f7fd0);
    this.world.addChild(this.playerView.view);

    // Normal play uses street customers only. Explicit indoor actors remain a
    // deterministic renderer/test fixture, never mixed into the street flow.
    const npcCount = options.outsideNpcs || options.realtime ? 0 : options.npcCount ?? 0;
    for (let i = 0; i < npcCount; i++) {
      const tile = this.pickFreeTile(this.spreadTile(i));
      const actor = new Actor(`npc-${i + 1}`);
      actor.setTilePosition(tile.tx, tile.ty);
      const view = this.createActorView(actor, i + 1, NPC_COLORS[i % NPC_COLORS.length]);
      this.world.addChild(view.view);
      this.wanderers.push({ actor, view, idleMs: 200 + this.random() * 1200 });
    }

    if (options.outsideNpcs && !options.realtime) {
      this.outsideNpcManager = new OutsideNpcManager({
        model: this.model,
        world: this.world,
        createView: (actor, index, color) => this.createActorView(actor, index, color),
        prepareView: this.npcAvatarSource ? () => this.prepareNpcView() : undefined,
        random: this.random,
        emotionTextures: options.npcEmotionTextures,
      });
    }

    this.cameraLayer.addChild(this.sceneArt, this.testGrid, this.world);
    this.view.addChild(this.backdrop, this.cameraLayer);

    this.camera = new RoomCamera(this.contentBounds(), {
      width: STAGE_WIDTH,
      height: STAGE_HEIGHT,
    });
    this.camera.setBitterMode(options.settings?.getBitterMode?.() ?? false);
    this.centerCameraOnScene();
    this.applyCamera();

    /** Gestos são registrados no piso e no fundo interativos. Um ancestral passivo não recebe a notificação; torná-lo static altera o alvo dos sprites descendentes. */

    for (const alvo of [this.floor, this.backdrop]) {
      alvo.on('pointerdown', this.onDragStart);
      alvo.on('pointerup', this.onDragEnd);
      alvo.on('pointerupoutside', this.onDragEnd);
      alvo.on('wheel', this.onWheel);
    }

    // `globalpointermove` é o único que não borbulha nem depende de acerto: o Pixi
    // o entrega à lista de elementos interativos. O fundo sempre está nela.
    this.backdrop.on('globalpointermove', this.onDragMove);
    if (options.roomSnapshot) this.backdrop.on('pointertap', (event) => {
      if (this.storeBar?.isOpen) this.onPointerTap(event);
    });

    if (this.keyboardCamera && typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
    }

    if (options.showHud ?? true) {
      this.hud = new Text({
        text: '',
        style: new TextStyle({
          fontFamily: [FONT_FAMILY, 'sans-serif'],
          fontSize: 16,
          fontWeight: '600',
          fill: 0x000000,
          lineHeight: 19,
        }),
      });
      this.hud.anchor.set(0, 1);
      this.hud.position.set(16, STAGE_HEIGHT - 12);
      this.hud.eventMode = 'none';
      this.view.addChild(this.hud);
      this.updateHud();
    }

    if (options.topBarsTextures) {
      this.topBars = new TopBars(options.topBarsTextures, options.playerState, options.rules?.levels);
      this.topBarsBaseWidth = options.topBarsTextures.back.width;
      this.view.addChild(this.topBars.view);
      if (isOffline()) this.topBars.setNote('Offline · salvo neste navegador');
    }
    // Same coin and XP icons as the top bars, cut from their shared atlas.
    const rewardIcon = (index: 0 | 1 | 2) => options.topBarsTextures && new Texture({
      source: options.topBarsTextures.icons.source,
      frame: new Rectangle(TOP_BAR_ICON_FRAMES[index].x, TOP_BAR_ICON_FRAMES[index].y, TOP_BAR_ICON_FRAMES[index].width, TOP_BAR_ICON_FRAMES[index].height),
    });
    this.floatingRewards = new FloatingRewards(this.world, { coin: rewardIcon(1), xp: rewardIcon(2) });
    this.view.addChild(this.levelUpToast.view);
    // Below the offline note under the top bars, when there is one.
    this.partyBadge.view.position.set(STAGE_WIDTH / 2, isOffline() ? 176 : 128);
    this.view.addChild(this.partyBadge.view);
    this.audio = options.audio;
    if (options.audioControl) {
      this.audioControl = new AudioHudControl(options.audioControl);
      this.view.addChild(this.audioControl.view);
    }

    if (options.actionBarTexture) {
      this.actionBarLayer.label = 'room-action-bar-layer';
      this.actionBarLayer.pivot.set(STAGE_WIDTH / 2, STAGE_HEIGHT);
      this.actionBarLayer.position.set(STAGE_WIDTH / 2, STAGE_HEIGHT);
      this.view.addChild(this.actionBarLayer);
      const growth = 1.15;
      const scale = MAIN_ACTION_BAR_SCALE;
      const bar = new Sprite(options.actionBarTexture);
      bar.label = 'room-action-bar';
      bar.anchor.set(0.5, 1);
      bar.position.set(STAGE_WIDTH / 2, STAGE_HEIGHT);
      bar.scale.set(scale); 
      bar.eventMode = 'none'; 
      this.actionBarLayer.addChild(bar);

      const left = bar.x - bar.width / 2;
      const top = bar.y - bar.height;
      if (options.topBarsTextures) {
        const betaSlots = createActionBarBetaSlots(options.topBarsTextures.icons);
        betaSlots.position.set(left, top);
        betaSlots.scale.set(scale);
        this.actionBarLayer.addChild(betaSlots);
      }
      if (options.npcEmotionTextures) {
        this.actionBarMood = new ActionBarMood(
          options.npcEmotionTextures, scale, options.playerState?.satisfaction, options.playerState?.cafeName,
        );
        this.actionBarMood.view.position.set(left, top);
        this.actionBarLayer.addChild(this.actionBarMood.view);
      }
      options.actionBarIcons?.forEach(({ name, texture }, index) => {
        const isTrophy = name === 'trophy';
        const isMail = name === 'mail';
        const holder = new Container();
        const icon = new Sprite(texture);
        holder.label = `room-action-bar-icon-${name}`;
        icon.anchor.set(0.5);
        const baseScale = 68 * scale * (isTrophy ? 1.1 : 1) / texture.height;
        icon.scale.set(baseScale);
        icon.eventMode = 'none';
        if (!isTrophy) {
          const shadow = new Graphics();
          const shadowRadius = Math.max(19 * growth, icon.width * 0.4);
          const shadowY = icon.height / 2 - 4 * growth;
          shadow.ellipse(0, shadowY, shadowRadius + 8 * growth, 6 * growth)
            .fill({ color: 0x17202a, alpha: 0.12 });
          shadow.ellipse(0, shadowY, shadowRadius, 4 * growth)
            .fill({ color: 0x17202a, alpha: 0.19 });
          shadow.eventMode = 'none';
          holder.addChild(shadow);
        }
        holder.addChild(icon);
        holder.position.set(
          left + (isTrophy ? 470 : isMail ? 1300 : 552 + (index - 1) * 86) * scale,
          top + (isTrophy ? 710 : 730) * scale,
        );
        holder.hitArea = new Rectangle(
          -icon.width / 2, -icon.height / 2 - 4 * growth,
          icon.width, icon.height + 14 * growth,
        );
        holder.eventMode = 'static';
        holder.cursor = 'pointer';
        if (isTrophy) {
          holder.on('pointerover', () => { icon.scale.set(baseScale * 1.1); });
          holder.on('pointerout', () => { icon.scale.set(baseScale); });
        } else {
          const hover = { sprite: icon, targetY: 0 };
          holder.on('pointerover', () => { hover.targetY = -6 * growth; });
          holder.on('pointerout', () => { hover.targetY = 0; });
          this.actionIconHovers.push(hover);
        }
        holder.on('pointerdown', (event) => { event.stopPropagation(); });
        holder.on('pointertap', (event) => {
          event.stopPropagation();
          this.onActionIcon(name);
        });
        if (isMail) {
          // Unread letters, over the envelope's corner.
          const badge = new Container();
          badge.label = 'room-action-bar-mail-badge';
          badge.addChild(new Graphics().circle(0, 0, 15 * growth).fill(0xd23b2a).stroke({ color: 0xffffff, width: 3 * growth }));
          const label = new Text({ text: '', style: new TextStyle({ fontFamily: FONT_FAMILY, fontSize: 18 * growth, fontWeight: '700', fill: 0xffffff }) });
          label.anchor.set(0.5);
          badge.addChild(label);
          badge.position.set(icon.width * 0.38, -icon.height * 0.36);
          badge.eventMode = 'none';
          badge.visible = false;
          holder.addChild(badge);
          this.mailBadge = { view: badge, label };
        }
        this.actionBarLayer.addChild(holder);
      });

      if (options.actionBarButtons) {
        const buttons = options.actionBarButtons;
        // Coordenadas na imagem original: abaixo da divisória e fora dos quadrados.
        const placements = [
          { name: 'left-arrow', texture: buttons.leftArrow, x: 289, y: 816 },
          { name: 'left-edge-arrow', texture: buttons.leftEdgeArrow, x: 289, y: 888 },
          { name: 'right-arrow', texture: buttons.rightArrow, x: 1395, y: 816 },
          { name: 'right-edge-arrow', texture: buttons.rightEdgeArrow, x: 1395, y: 888 },
          { name: 'settings', texture: buttons.settings, x: 1380, y: 730 },
        ];
        for (const placement of placements) {
          const button = new Sprite(placement.texture);
          const baseScale = 62 * 0.95 * (placement.name === 'settings' ? 1.15 : 1) * scale
            / placement.texture.height;
          let hovered = false;
          let pressed = false;
          const syncFeedback = () => {
            button.scale.set(baseScale * (pressed ? 0.9 : hovered ? 1.1 : 1));
            button.tint = pressed ? 0xd7ebff : 0xffffff;
          };
          button.label = `room-action-bar-${placement.name}`;
          button.anchor.set(0.5);
          button.scale.set(baseScale);
          button.position.set(left + placement.x * scale, top + placement.y * scale);
          button.eventMode = 'static';
          button.cursor = 'pointer';
          button.on('pointerover', () => { hovered = true; syncFeedback(); });
          button.on('pointerout', () => { hovered = false; pressed = false; syncFeedback(); });
          button.on('pointerdown', (event) => {
            event.stopPropagation();
            pressed = true;
            syncFeedback();
          });
          button.on('pointerup', (event) => {
            event.stopPropagation();
            pressed = false;
            syncFeedback();
          });
          button.on('pointerupoutside', () => { pressed = false; syncFeedback(); });
          button.on('pointertap', (event) => {
            event.stopPropagation();
            if (placement.name === 'settings') this.openSettings();
          });
          this.actionBarLayer.addChild(button);
        }
      }
    }

    if (options.storeBarTexture && options.actionBarTexture) {
      if (options.roomClient && options.roomSnapshot && this.artProvider) {
        this.roomStore = new RoomStoreController({ snapshot: options.roomSnapshot, client: options.roomClient,
          model: this.model, world: this.world, art: this.artProvider,
          apply: (snapshot) => this.applyRoomSnapshot(snapshot),
          alpha: (id, alpha) => this.setUnitAlpha(id, alpha),
          isOverUI: (event) => {
            if (this.storeBar?.containsGlobalPoint(event.global) || this.topBars?.containsGlobalPoint(event.global)) return true;
            return [this.hud, this.connectionHint].some((layer) => {
              if (!layer?.visible || !layer.renderable) return false;
              const bounds = layer.getBounds();
              return event.global.x >= bounds.x && event.global.y >= bounds.y
                && event.global.x <= bounds.x + bounds.width && event.global.y <= bounds.y + bounds.height;
            });
          },
          canPlace: (item, tile, rotation, id) => {
            if (!this.realtime) return true;
            if (!this.realtime.connected) return false;
            for (const state of this.realtime.actors.values()) if (id && (state.chairId === id || state.tableId === id)) return false;
            if (item.type < 2 || item.kind === 'window' || item.kind === 'panel') return true;
            const sx = rotation % 2 ? item.sizeY : item.sizeX, sy = rotation % 2 ? item.sizeX : item.sizeY;
            return ![...this.realtime.actors.values()].some((state) => [state, ...(state.move ? [state.move.from, state.move.to] : [])].some((position) => position.tx >= tile.tx && position.ty >= tile.ty && position.tx < tile.tx + sx && position.ty < tile.ty + sy));
          },
        });
      }
      this.storeBar = new StoreActionBar(
        options.storeBarTexture, options.actionBarTexture, options.actionBarButtons,
        options.actionBarButtons?.confirm,
        (open) => {
          this.actionBarLayer.visible = !open;
          this.playerView.view.renderable = !open;
          this.wanderers.forEach(({ view }) => { view.view.renderable = !open; });
          this.outsideNpcManager?.setRenderingEnabled(!open);
          this.liveActors.forEach(({ view }) => { view.view.renderable = !open; });
          this.mealViews.forEach((view) => { view.renderable = !open; });
          this.liveEmotions.forEach(({ effect }) => { effect.view.renderable = !open; });
          this.sharedCookingViews.forEach((view) => { view.renderable = !open; });
          this.sharedCookingProgress.forEach(({ bar }) => { bar.view.renderable = !open; });
          if (open) this.roomStore?.onOpen(); else this.roomStore?.onClose();
        },
        () => this.openSettings(),
        options.storeBarIcons,
        this.roomStore ? {
          onSelect: (entry) => this.roomStore!.select(entry),
          onCategory: () => this.roomStore!.onCategory(),
          onInventoryToggle: () => this.roomStore!.toggleInventory(),
          onDragStart: (entry, event) => {
            if (this.roomStore!.beginEntryDrag(entry, event)) { this.drag = null; this.dragCancelledTap = true; }
          },
          onDragEnd: (event) => this.onDragEnd(event),
          ...(options.roomSnapshot?.canEdit !== false && this.rules?.expansions ? { onExpand: () => this.openExpansion() } : {}),
        } : undefined,
        options.storeTopButtonTexture,
        options.actionBarIcons?.find(({ name }) => name === 'house')?.texture,
        options.storeToolbarTextures,
      );
      this.roomStore?.attach(this.storeBar);
      this.view.addChild(this.storeBar.view);
      if (this.roomStore) this.view.addChild(this.roomStore.cursorView);
    }

    if (options.cookTextures) {
      if (options.cookTextures.progressCallout) {
        this.cookCallout = new CookProgressCallout(options.cookTextures.progressCallout, options.cookTextures.calloutClock);
        this.cookCallout.view.scale.set(0.6);
        this.cookCallout.view.zIndex = POPUP_DRAW_PRIORITY + 2;
        this.world.addChild(this.cookCallout.view);
      }
      this.cookModal = new CookScreenModal({
        textures: options.cookTextures,
        onCookRecipe: (recipe) => this.startCooking(recipe),
        ...(options.audio ? { audio: options.audio } : {}),
      });
      this.view.addChild(this.cookModal.view);
    }
    if (options.wardrobeTextures) {
      const coveredLayers = [this.backdrop, this.cameraLayer, this.actionBarLayer];
      if (this.topBars) coveredLayers.push(this.topBars.view);
      let coveredVisibility: boolean[] | null = null;
      this.wardrobeModal = new WardrobeScreenModal({
        ...options.wardrobeTextures,
        ...(options.cookTextures?.closeButton ? { closeButton: options.cookTextures.closeButton } : {}),
        ...(options.actionBarButtons ? { pageButtons: options.actionBarButtons } : {}),
      }, (open) => {
        // A tela é opaca: a simulação continua, mas não desenhamos o quarto coberto.
        if (open) {
          coveredVisibility = coveredLayers.map((layer) => layer.visible);
          coveredLayers.forEach((layer) => { layer.visible = false; });
        } else if (coveredVisibility) {
          coveredLayers.forEach((layer, index) => { layer.visible = coveredVisibility![index]; });
          coveredVisibility = null;
        }
        options.onWardrobeVisibilityChange?.(open);
      }, {
        appearance: this.playerAppearance,
        onConfirm: async (look) => {
          const state = await saveAppearance(look);
          if (!this.destroyed) this.setPlayerState(state);
          return state.appearance ?? '';
        },
      });
      this.view.addChild(this.wardrobeModal.view);

      if (this.hud) this.view.addChild(this.hud);
    }
    this.settingsModal = new SettingsModal({
      ...options.settings,
      getBitterMode: () => this.camera.bitterMode,
      onBitterModeChange: (enabled) => {
        this.camera.setBitterMode(enabled);
        this.applyCamera();
        this.updateHud();
        options.settings?.onBitterModeChange?.(enabled);
      },
    });
    this.view.addChild(this.settingsModal.view);
    // Only the owner manages the café's employees.
    if (options.roomSnapshot && options.roomSnapshot.canEdit !== false && options.realtime) {
      this.staffModal = new StaffModal({
        client: new StaffClient(),
        locks: options.rules?.employeeLocks ?? [],
        portrait: (staffId) => this.staffPortrait(staffId),
        gold: () => this.roomSnapshot?.playerState?.gold ?? 0,
        ...(options.audio ? { audio: options.audio } : {}),
      });
      this.view.addChild(this.staffModal.view);
    }
    if (options.roomSnapshot && options.roomSnapshot.canEdit !== false && this.rules?.expansions) {
      const coin = rewardIcon(1);
      const cash = rewardIcon(0);
      const xp = rewardIcon(2);
      this.expansionModal = new ExpansionModal({
        rules: this.rules.expansions,
        client: new ExpansionClient(),
        tiles: () => Math.max(this.model.tilesX, this.model.tilesY),
        wallet: () => {
          const state = this.roomSnapshot?.playerState;
          return { level: state?.level ?? 1, gold: state?.gold ?? 0, cash: state?.cash ?? 0 };
        },
        onExpanded: (result) => this.celebrateExpansion(result),
        icons: { ...(coin ? { coin } : {}), ...(cash ? { cash } : {}), ...(xp ? { xp } : {}) },
        ...(options.audio ? { audio: options.audio } : {}),
      });
      this.view.addChild(this.expansionModal.view);
    }
    // What the café did while the owner was away: from the snapshot when a visitor
    // woke the room earlier, or from the owner's own welcome event.
    if (options.roomSnapshot && options.roomSnapshot.canEdit !== false) {
      this.welcomeBack = new WelcomeBackModal({
        onCollect: (summary) => this.collectAway(summary),
        ...(options.audio ? { audio: options.audio } : {}),
      });
      this.view.addChild(this.welcomeBack.view);
      if (options.roomSnapshot.awaySummary) this.queueAway(options.roomSnapshot.awaySummary);
      // Daily bonus and mail: the owner's own rewards, credited by the server.
      this.dailyModal = new DailyBonusModal({
        now: () => this.serverNow(),
        onClaim: () => claimDaily(),
        onClaimed: (claim) => {
          this.dailyNextAt = claim.daily.nextAt;
          this.collectReward(claim.reward, claim.state);
        },
        ...(options.audio ? { audio: options.audio } : {}),
      });
      this.view.addChild(this.dailyModal.view);
      this.mailModal = new MailModal({
        onClaim: (letter) => claimLetter(letter.id),
        onClaimed: (claim) => {
          this.setMailBadge(this.mailModal?.unread ?? 0);
          this.collectReward(claim.letter, claim.state);
        },
        ...(options.audio ? { audio: options.audio } : {}),
      });
      this.view.addChild(this.mailModal.view);
      this.checkDaily();
      void loadMail().then((mail) => { if (!this.destroyed) this.setMailBadge(mail.unread); })
        .catch((error: unknown) => console.warn('[correio] indisponível', error));
    }
    // Farm and disco actions (owner only); visitors just see the cards and the party.
    if (options.roomSnapshot && options.roomSnapshot.canEdit !== false && this.rules?.street) {
      const street = this.rules.street;
      this.streetModal = new StreetModal({
        rules: {
          farmBonusPercent: street.farm.bonusPercent, farmCooldownSeconds: street.farm.cooldownSeconds, farmMaxCharges: street.farm.maxCharges,
          partyMinutes: Math.round(street.disco.durationSeconds / 60), partyArrivalFactor: street.disco.arrivalFactor, partyTipMultiplier: street.disco.tipMultiplier,
        },
        street: () => this.street,
        serverNow: () => this.serverNow(),
        harvest: async () => {
          this.acceptStreet(await this.streetClient.harvest());
          this.audio?.play('season');
          this.levelUpToast.showMessage('Ingredientes frescos!', `A próxima receita rende +${street.farm.bonusPercent}% de moedas e XP`);
        },
        startParty: async () => {
          this.acceptStreet(await this.streetClient.startParty());
          this.audio?.play('levelUp');
          this.levelUpToast.showMessage('Festa do Bairro!', `Clientes ${String(street.disco.arrivalFactor).replace('.', ',')}× mais rápido e gorjeta ${street.disco.tipMultiplier}× do garçom`);
        },
        ...(options.audio ? { audio: options.audio } : {}),
      });
      this.view.addChild(this.streetModal.view);
    }
    if (options.roomSnapshot && options.roomSnapshot.canEdit !== false && this.rules) {
      this.levelUpModal = new LevelUpModal({
        art: this.recipeArt,
        ...(options.audio ? { audio: options.audio } : {}),
        onRecipes: () => this.openRecipeBook(),
        onStaff: () => this.openStaffScreen(),
        onExpand: () => this.openExpansion(),
      });
      this.view.addChild(this.levelUpModal.view);
    }
    this.confirmDialog = new ConfirmDialog(options.audio);
    this.view.addChild(this.confirmDialog.view);
    // Short notices go over the windows: a level-up while one is open falls back to them.
    this.view.addChild(this.levelUpToast.view);
    this.updateMobileHudLayout();
    if (options.cookingSnapshot) this.acceptCookingSnapshot(options.cookingSnapshot, true);
    if (this.realtime) {
      this.connectionHint = new Text({ text: 'Conectando ao quarto…', style: new TextStyle({ fontFamily: FONT_FAMILY, fontSize: 23, fill: 0xffffff, stroke: { color: 0x25304a, width: 4 } }) });
      this.connectionHint.position.set(25, STAGE_HEIGHT - 50); this.view.addChild(this.connectionHint);
      this.realtime.onStatus((connected) => {
        if (this.connectionHint) { this.connectionHint.visible = !connected; this.connectionHint.text = 'Conexão interrompida. Reconectando…'; }
      });
      this.realtime.onEvent((event) => this.acceptRoomEvent(event));
      void this.realtime.connect();
    }
  }

  private acceptRoomEvent(event: RoomEvent): void {
    if (this.destroyed || !this.realtime) return;
    if (event.type === 'welcome') {
      for (const [id, entry] of this.liveActors) if (id !== event.selfId) this.removeLiveActor(id, entry);
      this.liveActors.clear();
      if (event.world) this.acceptSharedWorld(event.world);
      this.foods = event.world?.foods ?? [];
      this.dirt = event.world?.dirt ?? [];
      if (event.world?.street) this.acceptStreet(event.world.street);
      if (event.away) this.queueAway(event.away);
      this.welcomed = true;
    }
    // Food and dirt events always carry the whole list; an absent field means none.
    if (event.type === 'food') this.foods = event.foods ?? [];
    if (event.type === 'dirt') this.dirt = event.dirt ?? [];
    if (event.type === 'world' && event.street) this.acceptStreet(event.street);
    for (const update of event.actors ?? []) {
      const state = this.realtime.actors.get(update.id); if (!state) continue;
      let entry = this.liveActors.get(state.id);
      const previousAction = entry?.state.action;
      const previous = entry?.state;
      if (!entry) {
        const own = state.id === this.realtime.selfId;
        const actor = own ? this.player : new Actor(state.id);
        actor.setTilePosition(state.tx, state.ty);
        const view = own ? this.playerView : this.createPlaceholderView(actor);
        if (!own) this.world.addChild(view.view);
        entry = { actor, view, state, appearanceRevision: 0 }; this.liveActors.set(state.id, entry);
        if (!own) void this.refreshLiveAppearance(state.id, state.appearance ?? '');
      } else {
        // A new role needs the other clip set (tray or bucket), so it bakes again.
        const changed = entry.state.appearance !== state.appearance || entry.state.role !== state.role; entry.state = state;
        if (changed && state.id !== this.realtime.selfId) void this.refreshLiveAppearance(state.id, state.appearance ?? '');
      }
      entry.state = state;
      entry.view.view.renderable = !this.storeBar?.isOpen;
      if (event.type !== 'welcome' && state.action?.kind === 'cooking' &&
          previousAction?.startedAt !== state.action.startedAt &&
          this.realtime.serverNowMs() < state.action.startedAt + state.action.duration) {
        this.audio?.play('cookStart');
      }
      if (event.type !== 'welcome' && previous && state.kind !== 'human') {
        // Only an arriving customer goes from outside to inside (leaving is the reverse),
        // and the server may finish entering in the same tick, so the state is not checked.
        if (previous.outside && !state.outside) this.audio?.play('doorBell');
        if (state.emotion?.kind === 'dissatisfied' && state.emotion.id !== previous.emotion?.id) this.audio?.play('buzzer', 0.8);
      }
    }
    if (event.type === 'payment' && event.payment) this.showPayment(event.payment);
    for (const id of event.removed ?? []) { const entry = this.liveActors.get(id); if (entry) { this.removeLiveActor(id, entry); this.liveActors.delete(id); } }
    if (event.type === 'world' && this.roomSnapshot && event.revision !== undefined && event.revision >= this.roomSnapshot.revision) {
      const units = new Map(this.roomSnapshot.inventory.map((unit) => [unit.unitId, unit]));
      for (const unit of event.units ?? []) {
        if (this.roomSnapshot.canEdit !== false || unit.placed) units.set(unit.unitId, unit); else units.delete(unit.unitId);
      }
      // An expansion also carries the new size; the new floor and walls come as units.
      const tilesX = event.tilesX ?? this.roomSnapshot.tilesX, tilesY = event.tilesY ?? this.roomSnapshot.tilesY;
      if ((event.units?.length ?? 0) > 0 || tilesX !== this.roomSnapshot.tilesX || tilesY !== this.roomSnapshot.tilesY) {
        this.applyRoomSnapshot({ ...this.roomSnapshot, revision: event.revision, tilesX, tilesY, inventory: [...units.values()] }, false);
      }
    }
    if (event.cooking) this.acceptSharedCooking(event.cooking);
    if (event.type === 'error') {
      this.target.clear();
      this.showNotice(event.message ?? 'Ação recusada.');
    }
  }

  private showNotice(message: string): void {
    if (!this.connectionHint) return;
    clearTimeout(this.noticeTimer); this.connectionHint.text = message; this.connectionHint.visible = true;
    this.noticeTimer = setTimeout(() => { if (this.connectionHint && this.realtime?.connected) this.connectionHint.visible = false; }, 3000);
  }

  /** Coins rise over the customer who paid; only the owner sees the level-up banner. */
  private showPayment(payment: SharedPayment): void {
    const entry = payment.actorId ? this.liveActors.get(payment.actorId) : undefined;
    if (entry) {
      const view = entry.view.view;
      this.floatingRewards.spawn(view.x, view.y, view.zIndex, payment.coins, payment.xp, payment.tip ?? 0, payment.freshCoins ?? 0);
    }
    this.audio?.play('coin');
    if (payment.levelUp && this.roomSnapshot?.canEdit !== false) this.celebrateLevel(payment.level, payment.levelReward);
  }

  /**
   * One celebration per level, from whichever arrives first: the payment
   * event or the player state (seasoning and cleaning also give XP).
   */
  private celebrateLevel(level: number, rewardCoins?: number): void {
    if (level <= this.knownLevel) return;
    const from = this.knownLevel;
    this.knownLevel = level;
    this.audio?.play('levelUp');
    const reward = rewardCoins ?? (this.rules?.levels ?? [])
      .filter((entry) => entry.level > from && entry.level <= level).reduce((sum, entry) => sum + entry.rewardCoins, 0);
    if (!this.levelUpModal || !this.rules || this.isModalOpen || this.storeBar?.isOpen) {
      this.levelUpToast.show(level, reward);
      return;
    }
    this.closeStoveActions();
    const tiles = Math.max(this.model.tilesX, this.model.tilesY);
    this.levelUpModal.show({ level, rewardCoins: reward, unlocks: levelUnlocks(this.rules, from, level, tiles), next: nextUnlocks(this.rules, level, tiles) });
  }

  private acceptSharedWorld(world: SharedWorld): void {
    if (!this.roomSnapshot) return;
    const units = new Map(this.roomSnapshot.inventory.map((unit) => [unit.unitId, { ...unit, placed: false }]));
    for (const unit of world.units) units.set(unit.unitId, unit);
    this.applyRoomSnapshot({ ...this.roomSnapshot, revision: world.revision, tilesX: world.tilesX || this.roomSnapshot.tilesX, tilesY: world.tilesY || this.roomSnapshot.tilesY,
      inventory: [...units.values()].filter((unit) => this.roomSnapshot!.canEdit !== false || unit.placed) }, false);
    if (world.cooking) this.acceptSharedCooking(world.cooking);
  }

  private acceptSharedCooking(snapshot: CookingSnapshot): void {
    this.cookingClient?.accept(snapshot);
    const current = this.cookingProcess;
    if (current && !snapshot.stoves.some((stove) => stove.id === current.stove.instanceId && stove.cooking?.id === this.occupiedStoves.get(stove.id)?.id)) this.clearCookingProcess();
    // Shared dishes are drawn for every stove; only local input controls the owner's modal.
    this.acceptCookingSnapshot(snapshot, false);
  }

  private removeLiveActor(id: string, entry: { actor: Actor; view: ActorRenderer; bundle?: BakedAvatarBundle; appearanceRevision: number; appearanceController?: AbortController }): void {
    entry.appearanceRevision++;
    entry.appearanceController?.abort();
    if (entry.actor !== this.player) { entry.view.destroy(); if (entry.bundle) releaseNpcAvatar(entry.bundle); }
    this.mealViews.get(id)?.destroy(); this.mealViews.delete(id);
    this.liveEmotions.get(id)?.effect.destroy(); this.liveEmotions.delete(id);
    this.patienceMeters.get(id)?.destroy(); this.patienceMeters.delete(id);
  }

  private async refreshLiveAppearance(id: string, appearance: string): Promise<void> {
    const entry = this.liveActors.get(id); if (!entry || !this.npcAvatarSource?.bakeAppearance) return;
    const revision = ++entry.appearanceRevision;
    entry.appearanceController?.abort();
    const controller = new AbortController(); entry.appearanceController = controller;
    try {
      const state = entry.state;
      const clips = state.kind === 'human' ? PLAYER_ROOM_CLIPS : state.kind === 'staff'
        ? state.role === 'cleaner' ? CLEANER_CLIPS : WAITER_CLIPS : ROOM_CLIPS;
      const bundle = await this.npcAvatarSource.bakeAppearance(appearance, clips, controller.signal);
      if (this.destroyed || this.liveActors.get(id) !== entry || entry.appearanceRevision !== revision) { releaseNpcAvatar(bundle); return; }
      if (entry.view instanceof AvatarActorView) {
        entry.view.setAppearance(bundle.baked, bundle.texture);
      } else {
        const renderer = new AvatarActorView(entry.actor, bundle.baked, bundle.texture);
        renderer.view.renderable = !this.storeBar?.isOpen;
        entry.view.destroy(); entry.view = renderer; this.world.addChild(renderer.view);
      }
      if (entry.bundle) releaseNpcAvatar(entry.bundle);
      entry.bundle = bundle;
    } catch (error) { if (!this.destroyed && !controller.signal.aborted) console.warn('[room] Não foi possível desenhar o visual do personagem.', error); }
  }

  private updateLiveActors(deltaMs: number): void {
    const now = this.realtime!.serverNowMs();
    for (const [id, entry] of this.liveActors) {
      const state = entry.state;
      if (this.realtime!.connected) entry.actor.syncAuthoritative(state.tx, state.ty, state.direction, state.outside, state.move, now);
      else { entry.actor.speedX = 0; entry.actor.speedY = 0; }
      if (state.state === 'entering' && entry.actor.tileX >= 1 && entry.actor.tileY >= 1) entry.actor.outside = false;
      if (state.kind === 'staff') {
        this.applyStaffClips(entry.view, state, now);
      } else {
        const action = state.state === 'eating' ? CLIP.EAT : state.state === 'seated' ? CLIP.SIT :
          state.state === 'cooking' || state.state === 'serving' ? CLIP.COOKING : state.state === 'cleaning' ? CLIP.CLEAN : null;
        entry.view.setActionClip?.(action, state.action ? now - state.action.startedAt : undefined);
      }
      this.advanceActorView(entry.view, deltaMs);
      this.updateLiveEmotion(id, state, entry.view.view, now);
      this.updatePatience(id, state, entry.view.view, now);
      const table = state.tableId && this.model.items.find((item) => item.inventoryUnitId === state.tableId);
      if (state.food && table) {
        // The plate shows the recipe the customer actually took from the counter.
        const texture = this.recipeArt.get(state.food.recipeId).stage2;
        let meal = this.mealViews.get(id);
        if (meal && meal.texture !== texture) { meal.destroy(); meal = undefined; }
        if (!meal) { meal = new Sprite(texture); meal.label = 'meal:' + state.food.id; meal.anchor.set(.5, .72); meal.width = 64; meal.height = 64; this.mealViews.set(id, meal); this.world.addChild(meal); }
        meal.position.set(tileToScreenX(table.tx, table.ty), tileToScreenY(table.tx, table.ty) - 30);
        meal.zIndex = itemDepth(table.tx, table.ty) + 1; meal.renderable = !this.storeBar?.isOpen;
        setItemOverlayDepth(meal, table);
      } else { this.mealViews.get(id)?.destroy(); this.mealViews.delete(id); }
    }
    this.updateTrayDishes();
    this.updateTableDirt(deltaMs, now);
    this.updateSharedStoves(now);
  }

  private updateLiveEmotion(id: string, state: SharedActor, actorView: Container, now: number): void {
    const emotion = state.emotion;
    let current = this.liveEmotions.get(id);
    if (!emotion || now >= emotion.startedAt + emotion.duration || current && current.id !== emotion.id) {
      current?.effect.destroy(); this.liveEmotions.delete(id); current = undefined;
    }
    if (!emotion || now >= emotion.startedAt + emotion.duration) return;
    const frames = this.npcEmotionTextures?.[emotion.kind];
    if (!current && frames?.length) {
      const effect = new NpcEmotion(frames);
      current = { id: emotion.id, effect }; this.liveEmotions.set(id, current); this.world.addChild(effect.view);
    }
    if (current) {
      current.effect.seek(now - emotion.startedAt, actorView);
      current.effect.view.renderable = !this.storeBar?.isOpen;
    }
  }

  private updateSharedStoves(now: number): void {
    const stoveIds = new Set<string>();
    const hidden = Boolean(this.storeBar?.isOpen);
    if (this.cookingProcess?.progress) this.cookingProcess.progress.view.renderable = !hidden;
    if (this.servingProcess?.progress) this.servingProcess.progress.view.renderable = !hidden;
    const servingByStove = new Map([...this.liveActors.values()].flatMap(({ state }) =>
      state.action?.kind === 'serving' && state.action.stoveId && now < state.action.startedAt + state.action.duration
        ? [[state.action.stoveId, state.action] as const] : []));
    let urgent = false;
    for (const stove of this.model.items) {
      if (stove.kind !== 'stove' || !stove.instanceId) continue;
      stoveIds.add(stove.instanceId);
      const job = this.occupiedStoves.get(stove.instanceId);
      const status = job ? stoveStatus(job, now) : undefined;
      this.noticeStoveStatus(stove.instanceId, status);
      const stale = job && status === 'ready' ? staleness(job, now) : 0;
      if (status === 'ready' && stale > 0.6) urgent = true;
      const preparing = cookingTime(job?.preparingAt ?? job?.startedAt ?? '');
      const start = cookingTime(job?.startedAt ?? '');
      const serving = servingByStove.get(stove.instanceId);
      const mode = serving ? 'serving' : job && now < start ? 'cooking' : undefined;
      const elapsed = serving ? now - serving.startedAt : now - preparing;
      const duration = serving?.duration ?? start - preparing;
      const pending = this.pendingCook?.stove === stove || this.servingProcess?.stove === stove && this.servingProcess.phase === 'walking';
      this.stoveViews.get(stove)?.forEach((view) => { view.alpha = mode || pending ? TARGET_STOVE_ALPHA : 1; });
      const localProgress = this.servingProcess?.stove === stove && this.servingProcess.progress?.view.visible ||
        this.cookingProcess?.stove === stove && this.cookingProcess.progress?.view.visible;
      let progress = this.sharedCookingProgress.get(stove.instanceId);
      if (!mode || localProgress || !job) {
        progress?.bar.destroy(); this.sharedCookingProgress.delete(stove.instanceId);
      } else {
        if (progress?.mode !== mode) {
          progress?.bar.destroy(); this.sharedCookingProgress.delete(stove.instanceId);
          const bar = this.makeStoveProgress(stove, mode);
          if (bar) { progress = { mode, bar }; this.sharedCookingProgress.set(stove.instanceId, progress); }
        }
        if (progress) { progress.bar.setProgress(elapsed / Math.max(1, duration)); progress.bar.view.renderable = !hidden; }
      }
      const burnerX = tileToScreenX(stove.tx, stove.ty);
      const burnerY = tileToScreenY(stove.tx, stove.ty) - 11;
      let effects = this.stoveEffects.get(stove.instanceId);
      if (!effects) { effects = new StoveEffects(); this.stoveEffects.set(stove.instanceId, effects); this.world.addChild(effects.view); }
      effects.update(this.lastDeltaMs, { status: status ?? 'empty', staleness: stale, seasoned: Boolean(job?.seasoned) },
        burnerX, burnerY, itemDepth(stove.tx, stove.ty), !hidden);
      // A spoiled dish darkens; the local process view follows the same rule.
      const tint = status === 'spoiled' ? 0x5c4a3e : 0xffffff;
      if (this.cookingProcess?.stove === stove) {
        this.cookingProcess.view.tint = tint;
        if (status === 'ready' || status === 'spoiled') this.cookingProcess.view.texture = this.cookingProcess.stage2Texture;
      }
      const art = job ? this.recipeArt.get(job.recipeId) : undefined;
      const texture = art && (status === 'ready' || status === 'spoiled' ? art.stage2 : art.stage1);
      if (!job || !texture || this.cookingProcess?.stove === stove) { this.sharedCookingViews.get(stove.instanceId)?.destroy(); this.sharedCookingViews.delete(stove.instanceId); continue; }
      let view = this.sharedCookingViews.get(stove.instanceId);
      if (!view) { view = new Sprite(texture); view.anchor.set(.5, .72); view.label = 'shared-stove:' + stove.instanceId; this.sharedCookingViews.set(stove.instanceId, view); this.world.addChild(view); }
      if (view.texture !== texture) view.texture = texture;
      view.width = 92; view.height = 92;
      view.tint = tint;
      view.alpha = mode === 'serving' ? TARGET_STOVE_ALPHA : 1;
      view.renderable = !hidden;
      view.position.set(burnerX, burnerY); view.zIndex = itemDepth(stove.tx, stove.ty) + 1;
      setItemOverlayDepth(view, stove);
    }
    for (const [id, view] of this.sharedCookingViews) if (!stoveIds.has(id)) { view.destroy(); this.sharedCookingViews.delete(id); }
    for (const [id, { bar }] of this.sharedCookingProgress) if (!stoveIds.has(id)) { bar.destroy(); this.sharedCookingProgress.delete(id); }
    for (const [id, effects] of this.stoveEffects) if (!stoveIds.has(id)) { effects.destroy(); this.stoveEffects.delete(id); }
    this.stovesUrgent = urgent && this.roomSnapshot?.canEdit !== false;
    this.updateCounters();
  }

  /** Spoiling is noticed once per dish, and only when seen fresh in this session. */
  private noticeStoveStatus(stoveId: string, status: StoveStatus | undefined): void {
    const previous = this.stoveStatuses.get(stoveId);
    if (status === undefined) { this.stoveStatuses.delete(stoveId); return; }
    this.stoveStatuses.set(stoveId, status);
    if (status === 'spoiled' && previous && previous !== 'spoiled') {
      this.audio?.play('buzzer');
      if (this.roomSnapshot?.canEdit !== false) this.showNotice('Um prato estragou no fogão! Clique nele para limpar.');
    }
  }

  /** Each counter shows its dish and remaining servings from the shared food list. */
  private updateCounters(): void {
    const present = new Set<string>();
    for (const counter of this.model.items) {
      if (counter.kind !== 'counter' || !counter.inventoryUnitId) continue;
      const food = this.foods.find((candidate) => candidate.counterId === counter.inventoryUnitId);
      if (!food) continue;
      present.add(counter.inventoryUnitId);
      const texture = this.recipeArt.get(food.recipeId).stage2;
      let dish = this.counterDishes.get(counter.inventoryUnitId);
      if (!dish) { dish = new CounterDish(texture); this.counterDishes.set(counter.inventoryUnitId, dish); this.world.addChild(dish.view); }
      dish.set(texture, Math.max(1, food.servings ?? 1), food.fresh ?? 0);
      // The counter's worktop is 52 px above its tile centre.
      dish.view.position.set(tileToScreenX(counter.tx, counter.ty), tileToScreenY(counter.tx, counter.ty) + 40 - 52 + 8);
      dish.view.renderable = !this.storeBar?.isOpen;
      setItemOverlayDepth(dish.view, counter);
    }
    for (const [id, dish] of this.counterDishes) if (!present.has(id)) { dish.destroy(); this.counterDishes.delete(id); }
  }

  /** Mirrors the server's kitchenIdle: no counter servings and no unspoiled batch on a stove. */
  private kitchenIdle(serverNowMs: number): boolean {
    if (this.foods.length > 0) return false;
    for (const job of this.occupiedStoves.values()) if (stoveStatus(job, serverNowMs) !== 'spoiled') return false;
    return true;
  }

  /**
   * Staff clips: waiters walk with the tray (and stand holding it while they
   * carry a dish), cleaners carry bucket and brush; work uses the original
   * WAITOR_WORKING and CLEAN clips.
   */
  private applyStaffClips(view: ActorRenderer, state: SharedActor, now: number): void {
    const cleaner = state.role === 'cleaner';
    view.setBaseClips?.(cleaner ? CLIP.CLEANER_WALK : CLIP.WAITOR_WALK, cleaner ? CLIP.CLEANER_IDLE : CLIP.IDLE);
    const elapsed = state.action ? now - state.action.startedAt : undefined;
    if (state.state === 'cleaning') view.setActionClip?.(CLIP.CLEAN, elapsed);
    else if (state.state === 'picking' || state.state === 'busing') view.setActionClip?.(CLIP.WAITOR_WORKING, elapsed);
    else if (state.state === 'carrying') view.setActionClip?.(CLIP.WAITOR_WALK, 0);
    else view.setActionClip?.(null);
  }

  /** The dish a waiter carries rides on the tray: a child of the actor view, so it shares its depth. */
  private updateTrayDishes(): void {
    const present = new Set<string>();
    for (const [id, entry] of this.liveActors) {
      const food = entry.state.kind === 'staff' ? entry.state.food : undefined;
      if (!food) continue;
      present.add(id);
      const view = entry.view.view;
      const texture = this.recipeArt.get(food.recipeId).stage2;
      let dish = this.trayDishes.get(id);
      if (dish && (dish.destroyed || dish.parent !== view || dish.texture !== texture)) {
        if (!dish.destroyed) dish.destroy();
        dish = undefined;
      }
      if (!dish) {
        dish = new Sprite(texture);
        dish.label = 'tray-dish';
        dish.anchor.set(0.5, 0.75);
        dish.eventMode = 'none';
        this.trayDishes.set(id, dish);
        view.addChild(dish);
      }
      // The actor view is scaled; the dish keeps a fixed world size.
      const scale = view.scale.x || 1;
      dish.width = TRAY_DISH_SIZE / scale;
      dish.height = TRAY_DISH_SIZE / scale;
      // Facing right (directions 1–3) the tray is on the right of the body.
      const side = entry.actor.direction >= 1 && entry.actor.direction <= 3 ? 1 : entry.actor.direction >= 5 ? -1 : 0;
      dish.position.set(side * TRAY_OFFSET_X / scale, -TRAY_HEIGHT / scale);
    }
    for (const [id, dish] of this.trayDishes) if (!present.has(id)) { if (!dish.destroyed) dish.destroy(); this.trayDishes.delete(id); }
  }

  /** Dirty plates sit on their table once nobody is eating there; cleared ones sparkle away. */
  private updateTableDirt(deltaMs: number, now: number): void {
    const eating = new Set<string>();
    for (const state of this.realtime?.actors.values() ?? []) if (state.food && state.tableId) eating.add(state.tableId);
    const present = new Set<string>();
    const owner = this.roomSnapshot?.canEdit !== false;
    for (const dirt of this.dirt) {
      const table = this.model.items.find((item) => item.kind === 'table' && item.inventoryUnitId === dirt.tableId);
      if (!table || eating.has(dirt.tableId)) continue;
      present.add(dirt.tableId);
      let view = this.tableDirt.get(dirt.tableId);
      if (!view || view.vanishing) {
        view?.destroy();
        view = new TableDirt();
        if (owner) {
          view.view.eventMode = 'static';
          view.view.cursor = 'pointer';
          this.bindSceneryTap(view.view, () => this.cleanTableAt(table));
        }
        this.tableDirt.set(dirt.tableId, view);
        this.world.addChild(view.view);
      }
      view.setPlates(dirt.plates);
      view.view.position.set(tileToScreenX(table.tx, table.ty), tileToScreenY(table.tx, table.ty) - 30);
      view.view.renderable = !this.storeBar?.isOpen;
      setItemOverlayDepth(view.view, table);
      view.update(deltaMs, now - dirt.since, now);
    }
    for (const [id, view] of this.tableDirt) {
      if (present.has(id)) continue;
      const table = this.model.items.find((item) => item.inventoryUnitId === id);
      // A table that was moved away just loses its plates.
      if (!table) { view.destroy(); this.tableDirt.delete(id); continue; }
      // Cleared: the plates stay while the brush works, then sparkle away.
      if (!view.vanishing && this.cleaningBeside(table, now)) { view.update(deltaMs, 0, now); continue; }
      view.vanish();
      if (view.update(deltaMs, 0, now)) { view.destroy(); this.tableDirt.delete(id); }
    }
  }

  private cleaningBeside(table: RoomItem, now: number): boolean {
    for (const state of this.realtime?.actors.values() ?? []) {
      if (state.state !== 'cleaning' || !state.action || now >= state.action.startedAt + state.action.duration) continue;
      if (footprintTiles(table).some((tile) => Math.abs(tile.tx - state.tx) + Math.abs(tile.ty - state.ty) === 1)) return true;
    }
    return false;
  }

  /** The owner walks beside a dirty table and clears it (server-checked). */
  private cleanTableAt(table: RoomItem): void {
    if (this.roomSnapshot?.canEdit === false || this.tableCleaning || this.servingProcess || this.startingCook) return;
    if (this.realtime && !this.realtime.connected) return;
    const approach = this.findCookingApproach(table);
    if (!approach) {
      this.showNotice('Não há como chegar até essa mesa.');
      return;
    }
    this.tableCleaning = { table, phase: 'walking' };
    if (approach.path.length) {
      this.movePlayerAlong(approach.path);
      this.drawTarget(approach.destination);
    }
  }

  private requestTableClean(): void {
    const process = this.tableCleaning;
    if (!process || process.phase !== 'walking' || !process.table.inventoryUnitId) return;
    process.phase = 'requesting';
    const table = process.table;
    void cleanTable(table.inventoryUnitId!).then((result) => {
      if (this.destroyed) return;
      this.audio?.play('broom');
      if (result.xp > 0) this.floatingRewards.spawn(tileToScreenX(table.tx, table.ty), tileToScreenY(table.tx, table.ty), itemDepth(table.tx, table.ty), 0, result.xp);
    }).catch((error: unknown) => {
      if (!this.destroyed) this.showNotice(error instanceof Error ? error.message : 'Não foi possível limpar a mesa.');
    }).finally(() => {
      if (this.tableCleaning === process) this.tableCleaning = undefined;
      this.target.clear();
    });
  }

  private updatePatience(id: string, state: SharedActor, actorView: Container, now: number): void {
    let meter = this.patienceMeters.get(id);
    const fetching = state.state === 'seated' && state.action?.kind === 'fetching' ? state.action : undefined;
    if (!fetching && (!state.patience || state.state !== 'seated')) {
      if (meter) { meter.destroy(); this.patienceMeters.delete(id); }
      return;
    }
    if (!meter) { meter = new PatienceMeter(); this.patienceMeters.set(id, meter); this.world.addChild(meter.view); }
    if (fetching) meter.updateFetch(fetchProgress(fetching, now), actorView);
    else if (state.patience) meter.update(patienceLeft(state.patience, now), actorView, now, state.browsing === true || this.kitchenIdle(now));
    meter.view.renderable = !this.storeBar?.isOpen;
  }

  private movePlayerAlong(path: readonly Tile[]): void {
    if (!this.realtime) { this.player.setMovePath(path); return; }
    const destination = path.at(-1); if (!destination) return;
    this.networkPending++;
    void this.realtime.command('walk', destination).catch((error: unknown) => {
      console.info('[room]', error); this.pendingCook = undefined; this.startingCook = false;
      if (this.servingProcess?.phase === 'walking') this.clearServingProcess();
    }).finally(() => { this.networkPending--; });
  }

  /** Inicia o processo de cozimento de uma receita no fogão da sala. */
  startCooking(recipe: CookRecipeEvent): void {
    if (this.roomSnapshot?.canEdit === false) return;
    if (this.realtime && !this.realtime.connected) {
      this.showCookingProblem('Sem conexão com o café', 'Aguarde reconectar e tente de novo.');
      return;
    }
    if (this.startingCook || this.cancellingCook || this.servingProcess) {
      this.showCookingProblem('Aguarde um instante', 'Termine a ação no fogão antes de cozinhar outro prato.');
      return;
    }
    const stove = this.stoveIsFree(this.selectedStove) ? this.selectedStove : this.freeStove();
    if (!stove) {
      this.showCookingProblem('Nenhum fogão livre', 'Sirva ou espere um prato ficar pronto para cozinhar outro.');
      return;
    }
    const approach = this.findCookingApproach(stove);
    if (!approach) {
      this.showCookingProblem('Fogão inacessível', 'Libere um espaço ao lado do fogão para o seu personagem chegar.');
      return;
    }

    if (this.cookingClient) {
      if (!stove.instanceId) return;
      this.startingCook = true;
      this.pendingCook = { stove, recipe };
      this.stoveViews.get(stove)?.forEach((view) => { view.alpha = TARGET_STOVE_ALPHA; });
      if (approach.path.length > 0) {
        this.movePlayerAlong(approach.path);
        this.drawTarget(approach.destination);
      } else {
        this.beginServerPlacement();
      }
      return;
    }
    // Isolated room tests can still exercise the renderer without an HTTP server.
    this.showCooking(recipe, stove, undefined, false, approach);
  }

  private stoveIsFree(stove: RoomItem | undefined): stove is RoomItem {
    return Boolean(stove && stove.kind === 'stove' && this.model.items.includes(stove) && this.cookingProcess?.stove !== stove &&
      !(stove.instanceId && this.occupiedStoves.has(stove.instanceId)));
  }

  /** The first stove without a dish, in the room's order. */
  private freeStove(): RoomItem | undefined {
    return this.model.items.find((item) => this.stoveIsFree(item));
  }

  private showCookingProblem(title: string, detail: string): void {
    this.audio?.play('buzzer');
    this.levelUpToast.showMessage(title, detail);
  }

  private beginServerPlacement(): void {
    const pending = this.pendingCook;
    if (!pending || !this.cookingClient || !pending.stove.instanceId) return;
    this.pendingCook = undefined;
    this.target.clear();
    void this.cookingClient.start(pending.stove.instanceId, pending.recipe.id).then((snapshot) => {
        this.startingCook = false;
        if (this.destroyed) return;
        this.acceptCookingSnapshot(snapshot, false);
        const job = this.occupiedStoves.get(pending.stove.instanceId!);
        if (job) this.showCooking(pending.recipe, pending.stove, job);
        else this.stoveViews.get(pending.stove)?.forEach((view) => { view.alpha = 1; });
      }).catch((error: unknown) => {
        this.startingCook = false;
        this.stoveViews.get(pending.stove)?.forEach((view) => { view.alpha = 1; });
        console.warn('[cooking] preparo rejeitado', error);
        if (!this.destroyed) this.showNotice(error instanceof Error ? error.message : 'Não foi possível iniciar o preparo.');
        void this.cookingClient!.refresh().then((snapshot) => {
          if (!this.destroyed) this.acceptCookingSnapshot(snapshot, true);
        }).catch((refreshError: unknown) => console.warn('[cooking] falha ao atualizar fogões', refreshError));
      });
  }

  /** Aplica um snapshot autenticado; ao reentrar, reconstitui o prato sem repetir som/caminhada. */
  private acceptCookingSnapshot(snapshot: CookingSnapshot, restore: boolean): void {
    this.occupiedStoves.clear();
    for (const stove of snapshot.stoves) {
      if (stove.cooking) this.occupiedStoves.set(stove.id, stove.cooking);
    }
    // Every server snapshot recomputes the offer; an absent field means it no longer applies.
    this.emergencyRecipeId = snapshot.emergencyRecipeId;
    if (!restore || this.cookingProcess) return;
    for (const stove of this.model.items) {
      if (stove.kind !== 'stove' || !stove.instanceId) continue;
      const job = this.occupiedStoves.get(stove.instanceId);
      if (!job) continue;
      const art = this.recipeArt.get(job.recipeId);
      this.showCooking({ id: job.recipeId, name: this.recipeName(job.recipeId), stage1: art.stage1, stage2: art.stage2 }, stove, job, true);
      break;
    }
  }

  private recipeName(id: string): string {
    return this.rules?.recipes.find((recipe) => recipe.id === id)?.name ?? 'Prato';
  }

  private showCooking(
    recipe: CookRecipeEvent,
    stove: RoomItem,
    job?: StoveCooking,
    restore = false,
    approach?: { destination: Tile; path: Tile[] },
  ): void {
    const parsedPrepare = job ? cookingTime(job.preparingAt ?? job.startedAt) : NaN;
    const parsedStart = job ? cookingTime(job.startedAt) : NaN;
    const parsedReady = job ? cookingTime(job.readyAt) : NaN;
    const preparingAtMs = Number.isFinite(parsedPrepare) ? parsedPrepare : undefined;
    const startedAtMs = Number.isFinite(parsedStart) ? parsedStart : undefined;
    const readyAtMs = Number.isFinite(parsedReady) ? parsedReady : undefined;
    const nowMs = this.cookingClient?.serverNowMs() ?? 0;
    const ready = readyAtMs !== undefined && nowMs >= readyAtMs;
    const cooking = !ready && startedAtMs !== undefined && nowMs >= startedAtMs;
    const phase = ready ? 'ready' : cooking ? 'cooking' : restore ? 'preparing'
      : approach?.path.length ? 'walking' : 'preparing';
    const durationMs = cooking && readyAtMs !== undefined && startedAtMs !== undefined
      ? Math.max(1, readyAtMs - startedAtMs)
      : preparingAtMs !== undefined && startedAtMs !== undefined
        ? Math.max(1, startedAtMs - preparingAtMs) : LOCAL_COOKING_PREVIEW_MS;
    const elapsedMs = phase === 'cooking' && startedAtMs !== undefined
      ? Math.max(0, Math.min(durationMs, nowMs - startedAtMs))
      : phase === 'preparing' && preparingAtMs !== undefined
        ? Math.max(0, Math.min(durationMs, nowMs - preparingAtMs)) : 0;

    this.clearCookingProcess();
    this.selectedStove = stove;
    this.stoveViews.get(stove)?.forEach((view) => { view.alpha = phase === 'walking' || phase === 'preparing' ? TARGET_STOVE_ALPHA : 1; });

    const sx = tileToScreenX(stove.tx, stove.ty);
    const sy = tileToScreenY(stove.tx, stove.ty);

    // pink_stove.png: queimador em (80, 36), com offsets da arte (-80, -47).
    const burnerX = sx;
    const burnerY = sy - 11;

    const sprite = new Sprite(ready ? recipe.stage2 : recipe.stage1);
    sprite.label = `stove-cooking-${recipe.id}`;
    sprite.anchor.set(0.5, 0.72);
    sprite.width = 92;
    sprite.height = 92;
    sprite.position.set(burnerX, burnerY);
    sprite.zIndex = itemDepth(stove.tx, stove.ty, DEPTH_BIAS_ITEM) + 1;
    setItemOverlayDepth(sprite, stove);
    sprite.visible = restore || phase === 'cooking' || phase === 'ready';
    sprite.eventMode = 'static';
    sprite.cursor = 'pointer';
    this.bindStoveHover(sprite, stove);
    sprite.on('pointertap', (e) => {
      if (this.dragCancelledTap) return;
      e.stopPropagation();
      this.openCookScreen(stove);
    });

    this.world.addChild(sprite);

    const progress = this.makeStoveProgress(stove, 'cooking');
    if (progress) {
      progress.view.visible = restore && phase === 'preparing';
      if (restore && phase === 'preparing') progress.setProgress(elapsedMs / durationMs);
    }

    this.cookingProcess = {
      stove,
      recipeId: recipe.id,
      recipeName: recipe.name,
      stage: ready ? 2 : 1,
      phase,
      stage1Texture: recipe.stage1,
      stage2Texture: recipe.stage2,
      elapsedMs,
      durationMs,
      preparingAtMs,
      startedAtMs,
      readyAtMs,
      placementActive: !restore,
      view: sprite,
      progress,
    };
    if (restore || phase === 'cooking' || phase === 'ready') return;
    if (approach && approach.path.length > 0) {
      this.movePlayerAlong(approach.path);
      this.drawTarget(approach.destination);
    } else {
      this.beginPreparing();
    }
  }

  private makeStoveProgress(stove: RoomItem, mode: 'cooking' | 'serving'): CookProgressBar | undefined {
    const textures = this.cookProgressTextures;
    if (!textures?.progressBack || !textures.progressFront) return undefined;
    const progress = new CookProgressBar(textures.progressBack, textures.progressFront, mode);
    const stoveWidth = Math.max(160, ...((this.stoveViews.get(stove) ?? []).map((view) => view.width)));
    progress.view.scale.set(((stoveWidth + 20) / 456) * COOKING_PROGRESS_SCALE);
    progress.view.position.set(tileToScreenX(stove.tx, stove.ty), tileToScreenY(stove.tx, stove.ty) - 95);
    progress.view.zIndex = POPUP_DRAW_PRIORITY;
    this.world.addChild(progress.view);
    return progress;
  }

  private updateCookingCallout(): void {
    const callout = this.cookCallout;
    if (!callout) return;
    const stove = this.hoveredStove;
    if (!stove || this.isModalOpen || this.storeBar?.isOpen || this.stoveActions || this.drag ||
        this.servingProcess?.stove === stove) {
      callout.view.visible = false;
      return;
    }
    const process = this.cookingProcess?.stove === stove ? this.cookingProcess : undefined;
    const job = stove.instanceId ? this.occupiedStoves.get(stove.instanceId) : undefined;
    let progress: number;
    let remainingMs: number;
    if (job && this.cookingClient) {
      const start = cookingTime(job.startedAt);
      const end = cookingTime(job.readyAt);
      const now = this.cookingClient.serverNowMs();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || now < start || now >= end) {
        callout.view.visible = false;
        return;
      }
      progress = (now - start) / (end - start);
      remainingMs = end - now;
    } else if (process?.phase === 'cooking') {
      progress = process.elapsedMs / process.durationMs;
      remainingMs = process.durationMs - process.elapsedMs;
    } else {
      callout.view.visible = false;
      return;
    }
    const readyDish = process?.stage2Texture ?? (job ? this.recipeArt.get(job.recipeId).stage2 : undefined);
    if (!readyDish) {
      callout.view.visible = false;
      return;
    }
    callout.setRecipe(process?.recipeName ?? (job ? this.recipeName(job.recipeId) : 'Prato'), readyDish);
    callout.setProgress(progress);
    callout.setRemaining(remainingMs);
    const stoveSprite = this.stoveViews.get(stove)?.find((view): view is Sprite => view instanceof Sprite);
    callout.view.position.set(
      Math.round(stoveSprite ? stoveSprite.x + stoveSprite.width / 2 : tileToScreenX(stove.tx, stove.ty)),
      Math.round(stoveSprite ? stoveSprite.y + 6 : tileToScreenY(stove.tx, stove.ty) - 41),
    );
    callout.view.visible = true;
  }

  /** Escolhe um lado alcançável da pegada, priorizando a face cardinal do fogão. */
  private findCookingApproach(stove: RoomItem): { destination: Tile; path: Tile[] } | null {
    const candidates: Array<{ destination: Tile; path: Tile[]; diagonal: boolean }> = [];
    for (const tile of footprintTiles(stove)) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const destination = { tx: tile.tx + dx, ty: tile.ty + dy };
        if (!this.model.isWalkable(destination.tx, destination.ty)) continue;
        const route = findPath({
          start: { tx: this.player.tileX, ty: this.player.tileY },
          dest: destination,
          isWalkable: this.model.isWalkable,
          maxTilesX: this.model.tilesX,
          maxTilesY: this.model.tilesY,
        });
        // O hitbox pode já estar neste tile na metade do passo, enquanto a arte
        // ainda chega nele. A ação só começa quando o movimento visual termina.
        const path = route && route.length === 0 && this.player.moving ? [destination] : route;
        if (path) candidates.push({ destination, path, diagonal: dx !== 0 && dy !== 0 });
      }
    }
    candidates.sort((a, b) => Number(a.diagonal) - Number(b.diagonal) || a.path.length - b.path.length);
    return candidates[0] ?? null;
  }

  private beginPreparing(): void {
    const process = this.cookingProcess;
    if (!process || process.phase === 'ready' || process.phase === 'cooking' || process.view.visible) return;
    if (process.preparingAtMs !== undefined && this.cookingClient) {
      process.elapsedMs = Math.max(0, Math.min(process.durationMs, this.cookingClient.serverNowMs() - process.preparingAtMs));
      if (process.elapsedMs >= process.durationMs) {
        process.view.visible = true;
        this.finishPlacement();
        return;
      }
    }
    process.phase = 'preparing';
    process.view.visible = true;
    if (process.progress) {
      process.progress.view.visible = true;
      process.progress.setProgress(process.elapsedMs / process.durationMs);
      if (!this.realtime) this.audio?.play('cookStart');
    }
    this.target.clear();
    const deltaX = tileToScreenX(process.stove.tx, process.stove.ty) - this.player.x;
    const deltaY = tileToScreenY(process.stove.tx, process.stove.ty) - this.player.y;
    const facing = directionFromDelta(deltaX, deltaY);
    // O clipe COOKING tem apenas as quatro vistas diagonais.
    if (!this.realtime) {
      this.player.direction = facing % 2 === 1 ? facing : (facing + (deltaY < 0 ? 1 : 7)) % 8;
      this.playerView.setActionClip?.(CLIP.COOKING);
    }
  }

  private finishPlacement(): void {
    const process = this.cookingProcess;
    if (!process || process.phase === 'cooking' || process.phase === 'ready') return;
    process.phase = 'cooking';
    process.elapsedMs = 0;
    process.durationMs = process.startedAtMs !== undefined && process.readyAtMs !== undefined
      ? Math.max(1, process.readyAtMs - process.startedAtMs) : LOCAL_COOKING_DURATION_MS;
    process.progress?.setProgress(1);
    if (process.progress) process.progress.view.visible = false;
    this.stoveViews.get(process.stove)?.forEach((view) => { view.alpha = 1; });
    if (process.placementActive) this.playerView.setActionClip?.(null);
    process.placementActive = false;
    this.target.clear();
  }

  private finishCooking(): void {
    const process = this.cookingProcess;
    if (!process) return;
    process.phase = 'ready';
    process.stage = 2;
    process.elapsedMs = process.durationMs;
    process.view.texture = process.stage2Texture;
    process.progress?.setProgress(1);
    if (process.progress) process.progress.view.visible = false;
    this.stoveViews.get(process.stove)?.forEach((view) => { view.alpha = 1; });
    if (process.placementActive) this.playerView.setActionClip?.(null);
    process.placementActive = false;
  }

  private clearCookingProcess(): void {
    const process = this.cookingProcess;
    if (!process) return;
    this.playerView.setActionClip?.(null);
    this.stoveViews.get(process.stove)?.forEach((view) => { view.alpha = 1; });
    process.view.destroy();
    process.progress?.destroy();
    this.cookingProcess = undefined;
  }

  private closeStoveActions(): void {
    this.stoveActions?.destroy();
    this.stoveActions = undefined;
    this.stoveActionsStove = undefined;
  }

  /** Actions offered for a stove with a dish, by its current state and the viewer's role. */
  private stoveActionsFor(stove: RoomItem, job: StoveCooking | undefined, status: StoveStatus | undefined): StoveAction[] {
    const owner = this.roomSnapshot?.canEdit !== false;
    const actions: StoveAction[] = [];
    if (status === 'spoiled') {
      if (owner) actions.push({ kind: 'clean', caption: 'Limpar fogão', onTap: () => this.cleanStove(stove) });
      return actions;
    }
    if (owner) actions.push({ kind: 'clock', caption: 'Ver tempo', onTap: () => {
      if (!this.cookingClient) return;
      void this.cookingClient.refresh().then((snapshot) => {
        if (!this.destroyed) this.acceptCookingSnapshot(snapshot, true);
      }).catch((error: unknown) => console.warn('[cooking] falha ao consultar tempo', error));
    } });
    if (job && !job.seasoned && (status === 'preparing' || status === 'cooking')) {
      const bonus = this.rules ? Math.max(1, Math.ceil((this.rules.recipes.find((recipe) => recipe.id === job.recipeId)?.servings ?? 1) * this.rules.stove.seasonBonusPercent / 100)) : 1;
      actions.push({ kind: 'season', caption: `Temperar (+${bonus} ${bonus === 1 ? 'porção' : 'porções'})`, onTap: () => this.seasonStove(stove) });
    }
    if (owner) actions.push({ kind: 'cancel', caption: 'Cancelar', onTap: () => this.confirmCancel(stove, job) });
    return actions;
  }

  private showStoveActions(stove: RoomItem, actions?: StoveAction[]): void {
    if (this.stoveActionsStove === stove) {
      this.closeStoveActions();
      return;
    }
    this.closeStoveActions();
    const job = stove.instanceId ? this.occupiedStoves.get(stove.instanceId) : undefined;
    const list = actions ?? this.stoveActionsFor(stove, job, job && this.cookingClient ? stoveStatus(job, this.cookingClient.serverNowMs()) : undefined);
    if (list.length === 0) return;
    const menu = new StoveActionMenu(list);
    const stoveSprite = this.stoveViews.get(stove)?.find((view): view is Sprite => view instanceof Sprite);
    const stoveTopX = stoveSprite ? stoveSprite.x + stoveSprite.width / 2 : tileToScreenX(stove.tx, stove.ty);
    const stoveTopY = stoveSprite ? stoveSprite.y : tileToScreenY(stove.tx, stove.ty) - 47;
    // O primeiro botão é o de cima; a referência do ápice recebe uma pequena
    // correção vertical uniforme para qualquer arte de fogão.
    menu.view.position.set(Math.round(stoveTopX), Math.round(stoveTopY + STOVE_MENU_TOP_DROP));
    menu.view.zIndex = POPUP_DRAW_PRIORITY + 1;
    this.world.addChild(menu.view);
    this.stoveActions = menu;
    this.stoveActionsStove = stove;
    this.updateStoveActionTime();
  }

  private updateStoveActionTime(): void {
    const stove = this.stoveActionsStove;
    if (!stove || !this.stoveActions) return;
    const job = stove.instanceId ? this.occupiedStoves.get(stove.instanceId) : undefined;
    const process = this.cookingProcess?.stove === stove ? this.cookingProcess : undefined;
    const remaining = job && this.cookingClient
      ? cookingTime(job.readyAt) - this.cookingClient.serverNowMs()
      : process ? process.phase === 'ready' ? 0 : process.phase === 'cooking'
        ? process.durationMs - process.elapsedMs : LOCAL_COOKING_DURATION_MS : 0;
    this.stoveActions.setRemaining(remaining);
  }

  /** Owners and visitors: adds the bonus servings once and grants the seasoner XP. */
  private seasonStove(stove: RoomItem): void {
    this.closeStoveActions();
    if (!this.cookingClient || !stove.instanceId) return;
    void this.cookingClient.season(stove.instanceId).then((snapshot) => {
      if (this.destroyed) return;
      this.acceptCookingSnapshot(snapshot, false);
      this.stoveEffects.get(stove.instanceId!)?.burst();
      this.audio?.play('season');
      const xp = this.rules?.stove.seasonXp ?? 0;
      if (xp > 0) this.floatingRewards.spawn(tileToScreenX(stove.tx, stove.ty), tileToScreenY(stove.tx, stove.ty) + 60, itemDepth(stove.tx, stove.ty), 0, xp);
    }).catch((error: unknown) => {
      if (!this.destroyed) this.showNotice(error instanceof Error ? error.message : 'Não foi possível temperar.');
    });
  }

  /** Throws a spoiled dish away so the stove can cook again. */
  private cleanStove(stove: RoomItem): void {
    this.closeStoveActions();
    if (!this.cookingClient || !stove.instanceId) return;
    void this.cookingClient.clean(stove.instanceId).then((snapshot) => {
      if (this.destroyed) return;
      this.acceptCookingSnapshot(snapshot, false);
      if (this.cookingProcess?.stove === stove) this.clearCookingProcess();
      this.audio?.play('broom');
      const xp = this.rules?.stove.cleaningXp ?? 0;
      if (xp > 0) this.floatingRewards.spawn(tileToScreenX(stove.tx, stove.ty), tileToScreenY(stove.tx, stove.ty) + 60, itemDepth(stove.tx, stove.ty), 0, xp);
    }).catch((error: unknown) => {
      if (!this.destroyed) this.showNotice(error instanceof Error ? error.message : 'Não foi possível limpar o fogão.');
    });
  }

  /** Cancelling throws the dish away: ask first, saying how many coins come back.
   * The server decides the refund when the cancel arrives, so the full cost is
   * only promised for the preparation and the toast shows what it paid. */
  private confirmCancel(stove: RoomItem, job: StoveCooking | undefined): void {
    this.closeStoveActions();
    const percent = this.rules?.stove.cancelRefundPercent ?? 0;
    const cost = job?.costCoins ?? 0;
    const preparing = job ? stoveStatus(job, this.serverNow()) === 'preparing' : false;
    const cooking = cancelRefund(cost, false, percent);
    const coins = (n: number) => `${n} ${n === 1 ? 'moeda' : 'moedas'}`;
    const message = preparing && cost > 0
      ? `O prato vai para o lixo. Ainda no preparo, ${coins(cost)} ${cost === 1 ? 'volta' : 'voltam'} para você; com o fogo já aceso, ${cooking > 0 ? `${coins(cooking)} (${percent}% do custo)` : 'nada'}.`
      : cooking > 0
        ? `O prato vai para o lixo e ${coins(cooking)} ${cooking === 1 ? 'volta' : 'voltam'} para você (${percent}% do custo).`
        : 'O prato vai para o lixo e as moedas gastas nele não voltam.';
    this.confirmDialog.ask({
      title: 'Cancelar o preparo?', message, confirm: 'Cancelar preparo', cancel: 'Continuar', danger: true,
      onConfirm: () => {
        // The dish may have finished while the dialog was open: then there is nothing to cancel.
        const current = stove.instanceId ? this.occupiedStoves.get(stove.instanceId) : undefined;
        const status = current ? stoveStatus(current, this.serverNow()) : undefined;
        if (status === 'ready' || status === 'spoiled') {
          this.showCookingProblem('O prato ficou pronto', status === 'ready' ? 'Sirva-o no balcão em vez de cancelar.' : 'Limpe o fogão para cozinhar de novo.');
          return;
        }
        this.cancelStoveCooking(stove);
      },
    });
  }

  private cancelStoveCooking(stove: RoomItem): void {
    if (this.cancellingCook) return;
    this.closeStoveActions();
    if (!this.cookingClient || !stove.instanceId) {
      if (this.cookingProcess?.stove === stove && this.cookingProcess.phase !== 'ready') this.clearCookingProcess();
      return;
    }
    this.cancellingCook = true;
    void this.cookingClient.cancel(stove.instanceId).then((snapshot) => {
      this.cancellingCook = false;
      if (this.destroyed) return;
      this.acceptCookingSnapshot(snapshot, false);
      if (this.cookingProcess?.stove === stove) this.clearCookingProcess();
      const refund = snapshot.refund ?? 0;
      if (refund > 0) {
        const view = this.playerView.view;
        this.floatingRewards.spawn(view.x, view.y, view.zIndex, refund, 0);
        this.levelUpToast.showMessage('Preparo cancelado', `${refund} ${refund === 1 ? 'moeda devolvida' : 'moedas devolvidas'}`);
      }
    }).catch((error: unknown) => {
      this.cancellingCook = false;
      console.warn('[cooking] não foi possível cancelar', error);
      if (this.destroyed) return;
      this.showCookingProblem('Não deu para cancelar', error instanceof Error ? error.message : 'Tente de novo.');
      void this.cookingClient!.refresh().then((snapshot) => {
        if (this.destroyed) return;
        this.acceptCookingSnapshot(snapshot, false);
        if (!this.occupiedStoves.has(stove.instanceId!) && this.cookingProcess?.stove === stove) this.clearCookingProcess();
      }).catch((refreshError: unknown) => console.warn('[cooking] falha ao atualizar fogão', refreshError));
    });
  }

  private startServing(stove: RoomItem): void {
    if (this.servingProcess) return;
    const approach = this.findCookingApproach(stove);
    if (!approach) return;
    this.closeStoveActions();
    const progress = this.makeStoveProgress(stove, 'serving');
    if (progress) progress.view.visible = false;
    this.servingProcess = { stove, phase: 'walking', elapsedMs: 0, progress };
    this.stoveViews.get(stove)?.forEach((view) => { view.alpha = TARGET_STOVE_ALPHA; });
    if (this.cookingProcess?.stove === stove) this.cookingProcess.view.alpha = TARGET_STOVE_ALPHA;
    if (approach.path.length) {
      this.movePlayerAlong(approach.path);
      this.drawTarget(approach.destination);
    } else {
      this.beginServing();
    }
  }

  private beginServing(): void {
    const process = this.servingProcess;
    if (!process || process.phase !== 'walking') return;
    if (this.realtime) {
      if (!process.stove.instanceId) { this.clearServingProcess(); return; }
      process.phase = 'requesting';
      void this.realtime.command('serve_prepare', { stoveId: process.stove.instanceId }).then(() => {
        if (this.destroyed || this.servingProcess !== process) return;
        const action = this.realtime!.actors.get(this.realtime!.selfId)?.action;
        process.startedAtMs = action?.startedAt ?? this.realtime!.serverNowMs();
        process.durationMs = action?.duration ?? LOCAL_COOKING_PREVIEW_MS;
        this.showServingAnimation(process);
      }).catch((error: unknown) => {
        if (this.destroyed || this.servingProcess !== process) return;
        console.info('[cooking] Serviço recusado.', error); this.clearServingProcess();
        this.showNotice(error instanceof Error ? error.message : 'Não foi possível servir.');
      });
      return;
    }
    this.showServingAnimation(process);
  }

  private showServingAnimation(process: NonNullable<RoomScreen['servingProcess']>): void {
    process.phase = 'serving';
    process.progress?.setProgress(0);
    if (process.progress) process.progress.view.visible = true;
    this.target.clear();
    const dx = tileToScreenX(process.stove.tx, process.stove.ty) - this.player.x;
    const dy = tileToScreenY(process.stove.tx, process.stove.ty) - this.player.y;
    const facing = directionFromDelta(dx, dy);
    if (!this.realtime) {
      this.player.direction = facing % 2 === 1 ? facing : (facing + (dy < 0 ? 1 : 7)) % 8;
      this.playerView.setActionClip?.(CLIP.COOKING);
    }
  }

  private finishServing(): void {
    const process = this.servingProcess;
    if (!process || process.phase === 'finalizing') return;
    process.phase = 'finalizing';
    process.progress?.setProgress(1);
    if (!this.cookingClient) {
      this.clearServingProcess();
      this.clearCookingProcess();
      return;
    }
    if (!process.stove.instanceId) {
      console.warn('[cooking] fogão sem ID persistido; prato não removido');
      this.clearServingProcess();
      return;
    }
    void this.cookingClient.serve(process.stove.instanceId).then((snapshot) => {
      if (this.destroyed) return;
      this.acceptCookingSnapshot(snapshot, false);
      this.clearServingProcess();
      this.clearCookingProcess();
    }).catch((error: unknown) => {
      console.warn('[cooking] não foi possível servir', error);
      if (this.destroyed) return;
      this.clearServingProcess();
      this.showNotice(error instanceof Error ? error.message : 'Não foi possível servir.');
      void this.cookingClient!.refresh().then((snapshot) => {
        if (this.destroyed) return;
        this.acceptCookingSnapshot(snapshot, false);
        if (!this.occupiedStoves.has(process.stove.instanceId!) && this.cookingProcess?.stove === process.stove) {
          this.clearCookingProcess();
        }
      }).catch((refreshError: unknown) => console.warn('[cooking] falha ao atualizar fogão', refreshError));
    });
  }

  private clearServingProcess(): void {
    const process = this.servingProcess;
    if (!process) return;
    process.progress?.destroy();
    this.stoveViews.get(process.stove)?.forEach((view) => { view.alpha = 1; });
    if (this.cookingProcess?.stove === process.stove) this.cookingProcess.view.alpha = 1;
    this.playerView.setActionClip?.(null);
    this.servingProcess = undefined;
  }

  /** Abre a janela do Livro de Receitas do fogão. */
  openCookScreen(stove?: RoomItem): void {
    if (this.isModalOpen || this.storeBar?.isOpen) return;
    const requested = stove ?? this.selectedStove ?? this.model.items.find((item) => item.kind === 'stove');
    const selected = requested?.instanceId
      ? this.model.items.find((item) => item.kind === 'stove' && item.instanceId === requested.instanceId) ?? requested
      : requested;
    if (!selected || this.servingProcess || this.startingCook || this.cancellingCook) return;
    const process = this.cookingProcess?.stove === selected ? this.cookingProcess : undefined;
    const job = selected.instanceId ? this.occupiedStoves.get(selected.instanceId) : undefined;
    if (process || job) {
      this.handleBusyStove(selected, process, job);
      return;
    }
    // Visitors can only season a dish already on the fire.
    if (this.roomSnapshot?.canEdit === false) return;
    if (!this.cookingClient) {
      this.selectedStove = selected;
      this.openRecipeBook();
      return;
    }
    if (!selected.instanceId || this.checkingCookScreen) return;
    this.checkingCookScreen = true;
    void this.cookingClient.refresh().then((snapshot) => {
      if (this.destroyed) return;
      this.acceptCookingSnapshot(snapshot, true);
      if (this.isModalOpen || this.storeBar?.isOpen) return;
      const currentJob = this.occupiedStoves.get(selected.instanceId!);
      if (currentJob) {
        this.handleBusyStove(selected, undefined, currentJob);
        return;
      }
      this.selectedStove = selected;
      this.openRecipeBook();
    }).catch((error: unknown) => console.warn('[cooking] fogão indisponível', error))
      .finally(() => { this.checkingCookScreen = false; });
  }

  /** A ready dish is served (owner only); anything else opens the contextual menu. */
  private handleBusyStove(stove: RoomItem, process: RoomScreen['cookingProcess'], job: StoveCooking | undefined): void {
    const status: StoveStatus = job && this.cookingClient ? stoveStatus(job, this.cookingClient.serverNowMs())
      : process?.phase === 'ready' ? 'ready' : 'cooking';
    if (status === 'ready') {
      if (this.roomSnapshot?.canEdit === false) return;
      if (process && process.phase !== 'ready') this.finishCooking();
      this.startServing(stove);
      return;
    }
    this.showStoveActions(stove);
  }

  /** The book reads recipes from the server rules and the owner's coins and level. */
  private openRecipeBook(): void {
    if (!this.cookModal) return;
    if (!this.stoveIsFree(this.selectedStove)) this.selectedStove = this.freeStove() ?? this.selectedStove;
    if (!this.rules) {
      this.showNotice('Receitas indisponíveis. Recarregue o jogo.');
      return;
    }
    const state = this.roomSnapshot?.playerState;
    this.cookModal.setBook({
      recipes: this.rules.recipes,
      context: {
        level: state?.level ?? 1, gold: state?.gold ?? 0, ...(this.emergencyRecipeId ? { emergencyRecipeId: this.emergencyRecipeId } : {}),
        ...((this.street?.freshCharges ?? 0) > 0 && this.rules?.street ? { freshPercent: this.rules.street.farm.bonusPercent } : {}),
      },
      art: this.recipeArt,
    });
    this.cookModal.open();
  }

  /** Fecha a janela do Livro de Receitas do fogão. */
  closeCookScreen(): void {
    this.cookModal?.close();
  }

  openWardrobeScreen(): void {
    if (!this.wardrobeModal || this.isModalOpen || this.storeBar?.isOpen) return;
    this.drag = null;
    this.pinch = null;
    this.touchPoints.clear();
    this.hovered = null;
    this.highlight.clear();
    this.floor.cursor = 'pointer';
    this.wardrobeModal.open();
  }

  closeWardrobeScreen(): void {
    this.wardrobeModal?.close();
  }

  openStoreBar(): void {
    if (this.roomSnapshot?.canEdit === false) return;
    if (!this.storeBar || this.isModalOpen) return;
    this.drag = null;
    this.pinch = null;
    this.touchPoints.clear();
    this.hovered = null;
    this.highlight.clear();
    this.target.clear();
    this.floor.cursor = 'pointer';
    this.storeBar.open();
  }

  closeStoreBar(): void { this.storeBar?.close(); }

  private bindStoreItem(view: Container, unitId: () => string | undefined): void {
    const existingTap = view.listenerCount('pointertap') > 0;
    view.eventMode = 'static'; view.cursor = 'pointer';
    view.on('pointerdown', (event) => {
      if (this.storeBar?.isOpen && (event.ctrlKey || event.shiftKey) && !event.altKey) {
        event.stopPropagation(); this.drag = null; this.dragCancelledTap = false; return;
      }
      if (this.storeBar?.isOpen && this.roomStore?.beginDrag(event, unitId())) {
        this.drag = null; this.dragCancelledTap = true; return;
      }
      if (this.storeBar?.isOpen || !existingTap) this.onDragStart(event);
    });
    view.on('pointerup', this.onDragEnd); view.on('pointerupoutside', this.onDragEnd);
    view.on('pointertap', (event) => {
      if (this.storeBar?.isOpen && !this.dragCancelledTap && this.roomStore?.interact(event, unitId())) return;
      if (this.storeBar?.isOpen) { event.stopPropagation(); this.onPointerTap(event); }
      else if (!existingTap) this.onPointerTap(event);
    });
    view.on('wheel', this.onWheel);
  }

  private setUnitAlpha(id: string, alpha: number): void {
    const floor = this.floorUnitViews.get(id); if (floor) floor.alpha = alpha;
    for (const [item, views] of this.itemViews) {
      if (item.inventoryUnitId === id) views.forEach((view) => { view.alpha = alpha; });
      else if (item.wallpaperUnitId === id) for (const view of views) for (const child of view.children) {
        if (child.label?.includes(':paper:')) child.alpha = alpha;
      }
    }
  }

  private applyRoomSnapshot(snapshot: RoomSnapshot, updatePlayerState = true): void {
    if (this.destroyed) return;
    if (this.roomSnapshot && snapshot.revision < this.roomSnapshot.revision) return;
    this.roomSnapshot = snapshot; if (updatePlayerState) this.setPlayerState(snapshot.playerState);
    const old = new Map(this.model.items.map((item) => [item.inventoryUnitId, item]));
    const items = roomModelItems(snapshot, this.artProvider?.art).map((item) => {
      const previous = old.get(item.inventoryUnitId);
      if (!previous) return item;
      previous.wallpaperClassName = item.wallpaperClassName; previous.wallpaperUnitId = item.wallpaperUnitId;
      return Object.assign(previous, item);
    });
    this.closeStoveActions();
    // Expansion: the same model takes the new bounds, so walking, the store and
    // the NPCs use them right away; the new tiles light up for everyone inside.
    const oldX = this.model.tilesX, oldY = this.model.tilesY;
    if (snapshot.tilesX !== oldX || snapshot.tilesY !== oldY) {
      this.model.resize(snapshot.tilesX, snapshot.tilesY);
      drawTestGrid(this.testGrid, this.model);
      if (snapshot.tilesX >= oldX && snapshot.tilesY >= oldY) {
        this.partyLights.setRoom(snapshot.tilesX, snapshot.tilesY);
        const glow = new ExpansionGlow(newFloorTiles(oldX, oldY, snapshot.tilesX, snapshot.tilesY), FLOOR_DRAW_PRIORITY + 2);
        this.world.addChild(glow.view);
        this.expansionGlows.push(glow);
      }
    }
    this.doorViews.splice(0).forEach((door) => door.destroy());
    for (const views of this.itemViews.values()) for (const view of views) if (!view.destroyed) view.destroy({ children: true });
    this.itemViews.clear(); this.stoveViews.clear(); this.floorUnitViews.clear();
    this.floorArt.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.model.replaceItems(items); this.buildFloor();
    for (const item of this.model.items) this.addItem(item);
    this.roomStore?.acceptShared(snapshot);
    if (!this.realtime) this.player.clearPath();
  }

  openSettings(): void {
    if (this.isModalOpen) return;
    this.drag = null;
    this.pinch = null;
    this.touchPoints.clear();
    this.hovered = null;
    this.highlight.clear();
    this.closeStoveActions();
    if (this.cookCallout) this.cookCallout.view.visible = false;
    this.settingsModal?.open();
  }

  private get isModalOpen(): boolean {
    return Boolean(this.cookModal?.isOpen || this.wardrobeModal?.isOpen || this.settingsModal?.isOpen || this.staffModal?.isOpen ||
      this.levelUpModal?.isOpen || this.expansionModal?.isOpen || this.streetModal?.isOpen || this.welcomeBack?.isOpen ||
      this.confirmDialog?.isOpen || this.dailyModal?.isOpen || this.mailModal?.isOpen);
  }

  /** Bottom bar: open the system, or say it is not here yet (or not for visitors). */
  private onActionIcon(name: string): void {
    const soon = SOON_SYSTEMS[name];
    if (soon) {
      this.audio?.play('click');
      this.levelUpToast.showMessage('Em breve!', soon);
      return;
    }
    const owner = this.roomSnapshot?.canEdit !== false;
    if (!owner && (name === 'house' || name === 'waiter' || name === 'striped-chicken' || name === 'mail')) {
      this.audio?.play('buzzer');
      this.levelUpToast.showMessage('Apenas no seu próprio café', 'Volte ao seu café para usar a loja, a equipe, a fazenda e o correio.');
      return;
    }
    if (name === 'shirt') this.openWardrobeScreen();
    else if (name === 'house') this.openStoreBar();
    else if (name === 'waiter') this.openStaffScreen();
    else if (name === 'striped-chicken') this.onStreetTap('farm');
    else if (name === 'mail') this.openMail();
  }

  private openMail(): void {
    if (!this.mailModal || this.isModalOpen || this.storeBar?.isOpen) return;
    this.audio?.play('click');
    this.closeStoveActions();
    void loadMail().then((mail) => {
      if (this.destroyed || this.isModalOpen || this.storeBar?.isOpen) return;
      this.setMailBadge(mail.unread);
      this.mailModal?.show(mail);
    }).catch((error: unknown) => this.showNotice(error instanceof Error ? error.message : 'Correio indisponível.'));
  }

  private setMailBadge(unread: number): void {
    if (!this.mailBadge) return;
    this.mailBadge.view.visible = unread > 0;
    this.mailBadge.label.text = unread > 9 ? '9+' : String(unread);
  }

  /** Asks for today's bonus; an unclaimed one waits for the entry windows to finish. */
  private checkDaily(): void {
    if (!this.dailyModal) return;
    this.dailyNextAt = 0;
    void loadDaily().then((daily) => {
      if (this.destroyed) return;
      // A midnight that has not come yet by the server's clock asks again a bit later, never every frame.
      this.dailyNextAt = daily.nextAt > this.serverNow() ? daily.nextAt : this.serverNow() + DAILY_RETRY_MS;
      if (daily.claimable) this.pendingDaily = daily;
    }).catch((error: unknown) => {
      console.warn('[bônus diário] indisponível', error);
      if (!this.destroyed) this.dailyNextAt = this.serverNow() + DAILY_RETRY_MS;
    });
  }

  /** Once a day, after "Bem-vindo de volta!" and any level-up. */
  private showPendingDaily(): void {
    if (this.dailyNextAt > 0 && this.serverNow() >= this.dailyNextAt) this.checkDaily();
    const daily = this.pendingDaily;
    if (!daily || !this.dailyModal || this.pendingAway || this.isModalOpen || this.storeBar?.isOpen) return;
    if (this.realtime && !this.welcomed && Date.now() < this.dailyHeldUntil) return;
    this.pendingDaily = undefined;
    this.closeStoveActions();
    this.dailyModal.show(daily);
  }

  /** A reward the server already credited, collected in a window that shows it:
   * the coins float over the player and the HUD takes the new values. */
  private collectReward(reward: { coins: number }, state: PlayerState): void {
    if (reward.coins > 0) {
      const view = this.playerView.view;
      this.floatingRewards.spawn(view.x, view.y, view.zIndex, reward.coins, 0);
    }
    this.setPlayerState(state);
  }

  private queueAway(summary: AwaySummary): void {
    const shown = this.shownAway;
    if (!this.welcomeBack || (shown && summary.to <= shown.to)) return;
    // A summary that starts with the one already shown is that one merged with
    // a newer absence: while it is open, it is replaced; after Coletar, only
    // the newer part is shown.
    if (shown && summary.from === shown.from) {
      if (this.welcomeBack.isOpen) {
        this.shownAway = summary;
        this.welcomeBack.show(summary);
        return;
      }
      this.shownAway = summary;
      this.pendingAway = awayAddition(summary, shown);
      return;
    }
    this.pendingAway = summary;
  }

  /** The summary opens as soon as no other window is up (a level-up from the same absence goes first). */
  private showPendingAway(): void {
    const summary = this.pendingAway;
    if (!summary || !this.welcomeBack || this.isModalOpen || this.storeBar?.isOpen) return;
    this.pendingAway = undefined;
    // An addition keeps the merged summary it came from as the one shown.
    if (!this.shownAway || summary.to > this.shownAway.to) this.shownAway = summary;
    this.closeStoveActions();
    this.welcomeBack.show(summary);
  }

  /** Coins and XP were credited on waking; collecting confirms and plays the reward over the player. */
  private collectAway(summary: AwaySummary): void {
    void acknowledgeAway();
    if (summary.coins > 0 || summary.xp > 0) {
      const view = this.playerView.view;
      this.floatingRewards.spawn(view.x, view.y, view.zIndex, summary.coins, summary.xp, summary.tips, summary.freshCoins);
      this.audio?.play('coin');
    }
  }

  /** The server clock once one of the connections has synced it; the local clock until then. */
  private serverNow(): number {
    if (this.realtime?.hasClock) return this.realtime.serverNowMs();
    if (this.cookingClient?.hasClock) return this.cookingClient.serverNowMs();
    return Date.now();
  }

  private acceptStreet(street: StreetState): void {
    this.street = street;
    this.streetSecond = -1;
  }

  /**
   * Once per second: the building cards count down, the "!" shows what the
   * owner can collect, and the party (lights, music, badge) follows the server
   * instants, so visitors see it too and it ends on time without an event.
   */
  private updateStreet(): void {
    const now = this.serverNow();
    const second = Math.floor(now / 1000);
    if (second === this.streetSecond) return;
    this.streetSecond = second;
    const owner = this.roomSnapshot?.canEdit !== false;
    const farm = farmStatus(this.street, now, this.rules?.street?.farm.maxCharges ?? 1);
    const party = partyStatus(this.street, now);
    this.streetScenery?.setStatus('farm', farmCaption(farm), owner && farm.canHarvest);
    this.streetScenery?.setStatus('disco', partyCaption(party), owner && party.canStart);
    if (party.active) this.partyBadge.show(`Festa do Bairro · ${formatClock(party.endsInMs)}`);
    else this.partyBadge.hide();
    if (party.active === this.partyOn) return;
    this.partyOn = party.active;
    this.partyLights.setActive(party.active);
    this.streetScenery?.setParty(party.active);
    this.audio?.setOverride?.(party.active ? { id: FESTA_DO_BAIRRO.id, name: FESTA_DO_BAIRRO.name, song: FESTA_DO_BAIRRO } : null);
    this.rushIntensity = -1;
    this.updateRushIntensity();
  }

  /** The owner opens the building's window; everyone else just sees its card. */
  private onStreetTap(id: string): void {
    this.audio?.play('click');
    if (!this.streetModal || this.isModalOpen || this.storeBar?.isOpen || (id !== 'farm' && id !== 'disco')) return;
    this.closeStoveActions();
    this.streetModal.open(id as StreetBuildingId);
  }

  /** Expansão do Café (owner only): from the store header or the level-up shortcut. */
  openExpansion(): void {
    if (!this.expansionModal || this.isModalOpen) return;
    // The store closes so the room is in view when it grows.
    if (this.storeBar?.isOpen) this.storeBar.close();
    this.drag = null;
    this.pinch = null;
    this.touchPoints.clear();
    this.hovered = null;
    this.highlight.clear();
    this.closeStoveActions();
    if (this.cookCallout) this.cookCallout.view.visible = false;
    this.expansionModal.open();
  }

  /**
   * The café grew: the room applies the new snapshot (the world event may have
   * done it already), the HUD takes the new wallet and the owner celebrates.
   */
  private celebrateExpansion(result: ExpansionResult): void {
    if (this.destroyed) return;
    this.applyRoomSnapshot(result.room);
    this.audio?.play('levelUp');
    const reward = [`${sizeLabel(result.tiles)}`];
    if (result.rewardCoins > 0) reward.push(`+${result.rewardCoins} moedas`);
    if (result.xp > 0) reward.push(`+${result.xp} XP`);
    this.levelUpToast.showMessage('Café ampliado!', reward.join(' · '));
    const view = this.playerView.view;
    this.floatingRewards.spawn(view.x, view.y, view.zIndex, result.rewardCoins, result.xp);
  }

  /** Funcionários: slots by level, hire, switch role and dismiss (owner only). */
  openStaffScreen(): void {
    if (!this.staffModal || this.isModalOpen || this.storeBar?.isOpen) return;
    this.drag = null;
    this.pinch = null;
    this.touchPoints.clear();
    this.hovered = null;
    this.highlight.clear();
    this.closeStoveActions();
    if (this.cookCallout) this.cookCallout.view.visible = false;
    this.staffModal.open();
  }

  closeStaffScreen(): void { this.staffModal?.close(); }

  private staffPortrait(staffId: string): Texture | undefined {
    const view = this.liveActors.get('staff:' + staffId)?.view;
    return view instanceof AvatarActorView ? view.portraitTexture() : undefined;
  }

  /** Atores em cena, o jogador primeiro. Usado nos testes. */
  get actors(): Actor[] {
    if (this.realtime) return [this.player, ...[...this.liveActors.values()].filter((entry) => entry.actor !== this.player).map((entry) => entry.actor)];
    const outsideActors = this.outsideNpcManager ? this.outsideNpcManager.actors : [];
    return [this.player, ...this.wanderers.map((w) => w.actor), ...outsideActors];
  }

  get hoveredTile(): Tile | null {
    return this.hovered;
  }

  /**
   * Avatar definitivo quando disponível; atlas branco durante o carregamento.
   *
   * Index 0 is exclusively the player; NPCs draw from the randomized NPC pool.
   * Missing NPC atlases never reuse the player's personal appearance.
   */
  private createActorView(actor: Actor, index: number, bodyColor: number): ActorRenderer {
    let atlasIndex = 0;
    if (index !== 0) {
      const active = new Set(this.actors);
      for (const previous of this.npcAvatarIndices.keys()) {
        if (!active.has(previous)) this.npcAvatarIndices.delete(previous);
      }
      atlasIndex = this.npcLookPicker.pick(this.npcAvatarIndices.values());
      if (atlasIndex > 0) this.npcAvatarIndices.set(actor, atlasIndex);
    }
    const assado = this.avatars[atlasIndex];
    if (assado) return new AvatarActorView(actor, assado.baked, assado.texture);
    return this.createPlaceholderView(actor, bodyColor);
  }

  private createPlaceholderView(actor: Actor, bodyColor = 0xffffff): ActorRenderer {
    const atlas = this.placeholderAvatar;
    if (atlas) return new AvatarActorView(actor, atlas.baked, atlas.texture);
    return new ActorView(actor, { bodyColor });
  }

  private async prepareNpcView(): Promise<PreparedNpcView> {
    const bundle = await this.npcAvatarSource!.next();
    let ownedByView = false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseNpcAvatar(bundle);
    };
    return {
      createView: (actor) => {
        const renderer = new AvatarActorView(actor, bundle.baked, bundle.texture);
        ownedByView = true;
        return {
          view: renderer.view,
          sync: () => renderer.sync(),
          update: (deltaMs) => renderer.update(deltaMs),
          destroy: () => { renderer.destroy(); release(); },
        };
      },
      destroy: () => { if (!ownedByView) release(); },
    };
  }

  private addItem(item: RoomItem): void {
    const previous = new Set(this.world.children);
    this.paintItem(item);
    const views = this.world.children.filter((view) => !previous.has(view));
    this.itemViews.set(item, views);
    if (this.roomSnapshot) for (const view of views) this.bindStoreItem(view, () => item.wallpaperUnitId ?? item.inventoryUnitId);
    if (this.realtime && item.kind === 'chair' && item.inventoryUnitId) for (const view of views) view.on('pointertap', (event: FederatedPointerEvent) => {
      if (this.storeBar?.isOpen || this.dragCancelledTap || this.isModalOpen) return;
      event.stopPropagation(); void this.realtime!.command('sit', { chairId: item.inventoryUnitId }).catch((error: unknown) => console.info('[room]', error));
    });
  }

  private paintItem(item: RoomItem): void {
    if (item.kind === 'wall') {
      const paper = this.artProvider?.art.get(item.wallpaperClassName);
      let wallpaper: WallWallpaper | undefined;
      if (paper) {
        // One canonical face for both walls: mirror the sprite, not the PNG asset.
        const frame = paper.frames[0];
        const texture = this.artProvider?.textureFor(frame.file);
        if (texture) wallpaper = { frame, texture, sourceRotation: paper.wallpaperRotation ?? 0 };
      }
      const door = this.model.items.find((candidate) => candidate.kind === 'door' &&
        doorOpeningTile(candidate).tx === item.tx && doorOpeningTile(candidate).ty === item.ty);
      const nextTile = item.rotation % 2 === 0
        ? { tx: item.tx, ty: item.ty + 1 }
        : { tx: item.tx + 1, ty: item.ty };
      const nextWall = this.model.items.some((candidate) => candidate.kind === 'wall' &&
        candidate.tx === nextTile.tx && candidate.ty === nextTile.ty);
      const nextIsDoorOpening = this.model.items.some((candidate) => candidate.kind === 'door' &&
        doorOpeningTile(candidate).tx === nextTile.tx && doorOpeningTile(candidate).ty === nextTile.ty);
      // A parede termina visualmente no vão, mesmo que a verga do próximo tile
      // continue: sua espessura sombreada precisa aparecer ao lado da porta.
      const showEnd = !nextWall || nextIsDoorOpening;
      this.world.addChild(createProceduralWallView(item, wallpaper, door ? door.doorLintelRatio ?? 0.1 : undefined, showEnd));
      return;
    }
    const entry = this.artProvider?.art.get(item.className);
    if (entry) {
      const rotated = rotatedArt(entry, item.rotation);
      const texture = this.artProvider?.textureFor(rotated.frame.file);
      if (texture) {
        if (item.kind === 'door') {
          const door = new DoorView(item, rotated.frame, texture, entry.door);
          this.doorViews.push(door);
          this.world.addChild(door.view);
          return;
        }
        let bias = DEPTH_BIAS_ITEM;
        if (item.kind === 'window' || item.kind === 'panel') {
          bias = DEPTH_BIAS_WALL_DECOR;
        }
        const sprite = createArtView(item, rotated.frame, texture, { bias, occlusionAnchor: item.occlusionAnchor });
        if (item.kind === 'stove') {
          this.stoveViews.set(item, [sprite]);
          this.bindStoveTap(sprite, item);
        }
        this.world.addChild(sprite);
        return;
      }
    }

    // Sem arte: um pedaço de caixa por tile da pegada, cada um com sua
    // própria profundidade.
    for (const graphics of createItemViews(item)) {
      if (item.kind === 'stove') {
        const views = this.stoveViews.get(item) ?? [];
        views.push(graphics);
        this.stoveViews.set(item, views);
        this.bindStoveTap(graphics, item);
      }
      this.world.addChild(graphics);
    }
  }

  /** O fogão participa do mesmo gesto do piso: um toque novo limpa arrastes antigos. */
  private bindStoveTap(target: Sprite | Graphics, stove: RoomItem): void {
    target.eventMode = 'static';
    target.cursor = 'pointer';
    this.bindStoveHover(target, stove);
    target.on('pointerdown', this.onDragStart);
    target.on('pointerup', this.onDragEnd);
    target.on('pointerupoutside', this.onDragEnd);
    target.on('pointertap', (event) => {
      // Visitors reach openCookScreen too: it only offers them seasoning.
      if (this.dragCancelledTap) return;
      event.stopPropagation();
      this.openCookScreen(stove);
    });
  }

  private bindStoveHover(target: Sprite | Graphics, stove: RoomItem): void {
    target.on('pointerover', (event: FederatedPointerEvent) => {
      if (event.pointerType === 'touch') return;
      this.hoveredStove = stove;
      this.updateCookingCallout();
    });
    target.on('pointerout', () => {
      if (this.hoveredStove !== stove) return;
      this.hoveredStove = undefined;
      if (this.cookCallout) this.cookCallout.view.visible = false;
    });
  }

  /** Piso texturizado ou desenho procedural de fallback. */
  private buildFloor(): void {
    if (this.roomSnapshot) {
      drawFloor(this.floor, this.model); this.floor.alpha = 1;
      for (const unit of this.roomSnapshot.inventory) {
        const item = this.roomSnapshot.catalog.find((item) => item.id === unit.itemId);
        if (!unit.placed || item?.type !== 0) continue;
        const frame = this.artProvider?.art.get(item.classname)?.frames[0];
        const texture = frame ? this.artProvider?.textureFor(frame.file) : undefined;
        if (!frame || !texture) continue;
        const sprite = new Sprite(texture);
        sprite.label = `floor:${unit.tx},${unit.ty}`; sprite.roundPixels = true;
        sprite.position.set(tileToScreenX(unit.tx, unit.ty) + frame.left, tileToScreenY(unit.tx, unit.ty) + frame.top);
        sprite.hitArea = new Polygon(tileDiamond(0, 0).flatMap(({ x, y }) => [x - frame.left, y - frame.top]));
        rotateFloorSprite(sprite, frame, unit.rotation);
        this.floorArt.addChild(sprite); this.floorUnitViews.set(unit.unitId, sprite);
        this.bindStoreItem(sprite, () => unit.unitId);
      }
      return;
    }
    const entry = this.artProvider?.art.get(this.floorClassName);
    const texture = entry ? this.artProvider?.textureFor(entry.frames[0].file) : undefined;

    // O losango sempre existe: é ele que faz o hit test do clique. Com arte
    // real ele fica invisível, mas continua recebendo o ponteiro.
    drawFloor(this.floor, this.model);

    if (entry && texture) {
      this.floor.alpha = 0;
      for (const sprite of createFloorViews(this.model, entry.frames[0], texture)) {
        this.floorArt.addChild(sprite);
      }
    }
  }

  /** Cenário externo fica fora do sorter, mas dentro da câmera, compartilhando pan e zoom com o quarto. */

  private buildSceneBackground(): void {
    const background = this.artProvider?.art.sceneBackground;
    if (!background) return;
    const tiles = background.tiles ?? [background];
    const rendered = tiles.map((tile, index) => ({
      tile,
      index,
      texture: this.artProvider?.textureFor(tile.file),
    }));
    if (rendered.every((entry) => entry.texture === undefined)) return;

    // Terreno contínuo sob o cenário externo, inclusive nas áreas livres de sprites.
    const ground = new Graphics();
    ground.label = 'room-scene-ground';
    ground.rect(-12000, -12000, 24000, 24000).fill(0xa2c957);
    this.sceneArt.addChild(ground);
    for (const { tile, index, texture } of rendered) {
      if (!texture) continue;
      this.sceneArt.addChild(createSceneBackgroundView(
        tile,
        texture,
        index === 0 ? 'room-city-background' : `room-city-background-${index + 1}`,
      ));
    }
    // The lots of the street layout above belong to this background.
    this.streetScenery = new StreetScenery({
      world: this.world,
      bindGestures: (target, onTap) => this.bindSceneryTap(target, onTap),
      onTap: (def) => this.onStreetTap(def.id),
    });
  }

  /** Buildings keep the room gestures: dragging over them pans, the wheel zooms. */
  private bindSceneryTap(target: Container, onTap: () => void): void {
    target.on('pointerdown', this.onDragStart);
    target.on('pointerup', this.onDragEnd);
    target.on('pointerupoutside', this.onDragEnd);
    target.on('wheel', this.onWheel);
    target.on('pointertap', (event) => {
      if (this.dragCancelledTap || this.isModalOpen || this.storeBar?.isOpen) return;
      event.stopPropagation();
      onTap();
    });
  }

  /** Espalha os pontos de partida sem depender de sorteio. */
  private spreadTile(index: number): Tile {
    const spots: Tile[] = [
      { tx: 1, ty: 6 },
      { tx: 6, ty: 1 },
      { tx: 5, ty: 3 },
      { tx: 2, ty: 7 },
      { tx: 7, ty: 4 },
      { tx: 4, ty: 6 },
    ];
    return spots[index % spots.length];
  }

  /** Primeiro tile livre a partir de uma preferência. */
  private pickFreeTile(preferred: Tile): Tile {
    if (this.model.isWalkable(preferred.tx, preferred.ty)) return preferred;
    const free = this.model.walkableTiles();
    return free[0] ?? { tx: 0, ty: 0 };
  }

  /** Limites de pan derivados da geometria da sala e do cenário para acompanhar expansões sem expor áreas vazias. */

  private contentBounds(): CameraRect {
    const bg = this.artProvider?.art.sceneBackground;
    if (bg) {
      return {
        left: bg.left + SCENE_CAMERA_INSET,
        right: bg.left + bg.width - SCENE_CAMERA_INSET,
        top: bg.top + SCENE_CAMERA_TOP_INSET,
        bottom: Math.max(
          bg.top + bg.height - SCENE_CAMERA_INSET,
          tileToScreenY(SCENE_DIAGONAL_PAN_TILE, SCENE_DIAGONAL_PAN_TILE),
        ),
      };
    }
    return {
      left: tileToScreenX(0, this.model.tilesY) - CAMERA_PADDING,
      right: tileToScreenX(this.model.tilesX, 0) + CAMERA_PADDING,
      top: -MAX_ITEM_HEIGHT - CAMERA_PADDING,
      bottom: tileToScreenY(this.model.tilesX, this.model.tilesY) + CAMERA_PADDING,
    };
  }

  /** Preserva o enquadramento da sala ao ampliar só a área de pan inferior. */
  private centerCameraOnScene(): void {
    const bg = this.artProvider?.art.sceneBackground;
    if (!bg) return;
    this.camera.centerOn({ x: bg.left + bg.width / 2, y: bg.top + bg.height / 2 });
  }

  /** Alinha a câmera inteira à grade física, preservando a distância entre objetos estáticos. Os atores interpolados usam roundPixels individualmente. */

  private applyCamera(): void {
    this.cameraLayer.scale.set(this.camera.zoom);

    const grade = this.outerScale;
    this.cameraLayer.position.set(
      Math.round(this.camera.x * grade) / grade,
      Math.round(this.camera.y * grade) / grade,
    );
  }

  /** Retorna ao zoom mínimo selecionado, com a sala centrada. */
  resetCamera(): void {
    this.camera.reset();
    this.centerCameraOnScene();
    this.applyCamera();
    this.updateHud();
  }

  /** Desloca a câmera em px de stage. */
  panCameraBy(deltaX: number, deltaY: number): void {
    this.camera.panBy(deltaX, deltaY);
    this.applyCamera();
    this.updateHud();
  }

  /**
   * Multiplica o zoom, mantendo fixo o ponto de stage em `focus`. Sem `focus`,
   * o centro da tela.
   */
  zoomCameraBy(factor: number, focus?: { x: number; y: number }): void {
    this.camera.zoomBy(factor, focus);
    this.applyCamera();
    this.updateHud();
  }

  private onDragStart = (event: FederatedPointerEvent): void => {
    if (this.isModalOpen) return;
    if (this.roomStore?.beginDrag(event)) { this.drag = null; this.dragCancelledTap = true; return; }
    const local = this.view.toLocal(event.global);
    if (event.pointerType === 'touch') {
      this.touchPoints.set(event.pointerId, { x: local.x, y: local.y });
      if (this.touchPoints.size >= 2) {
        this.startPinch();
        return;
      }
    }
    this.drag = { pointerId: event.pointerId, lastX: local.x, lastY: local.y, travelled: 0 };
    this.dragCancelledTap = false;
    this.pinchCancelledTap = false;
  };

  private startPinch(): void {
    const [first, second] = [...this.touchPoints.values()];
    if (!first || !second) return;
    this.pinch = {
      startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      startZoom: this.camera.zoom,
      center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    };
    this.drag = null;
    this.dragCancelledTap = true;
    this.pinchCancelledTap = true;
  }

  private onDragMove = (event: FederatedPointerEvent): void => {
    if (this.isModalOpen) return;
    this.roomStore?.hover(event);

    // `globalpointermove` também chega quando o ponteiro está sobre o vazio
    // estrutural das paredes, onde o Graphics do piso deliberadamente não tem
    // geometria. Isso garante que o hover anterior seja removido ao sair do piso.
    this.updateHoveredTile(event);

    if (event.pointerType === 'touch' && this.touchPoints.has(event.pointerId)) {
      const local = this.view.toLocal(event.global);
      this.touchPoints.set(event.pointerId, { x: local.x, y: local.y });
      if (this.pinch) {
        const [first, second] = [...this.touchPoints.values()];
        if (!first || !second) return;
        const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
        this.camera.setZoom(this.pinch.startZoom * distance / this.pinch.startDistance, this.pinch.center);
        this.camera.panBy(center.x - this.pinch.center.x, center.y - this.pinch.center.y);
        this.pinch.center = center;
        this.dragCancelledTap = true;
        this.applyCamera();
        this.updateHud();
        return;
      }
    }

    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const local = this.view.toLocal(event.global);
    const deltaX = local.x - drag.lastX;
    const deltaY = local.y - drag.lastY;
    drag.lastX = local.x;
    drag.lastY = local.y;
    drag.travelled += Math.hypot(deltaX, deltaY);

    if (drag.travelled < DRAG_THRESHOLD) return;

    this.dragCancelledTap = true;
    this.floor.cursor = 'grabbing';
    this.panCameraBy(deltaX, deltaY);
  };

  private onDragEnd = (event: FederatedPointerEvent): void => {
    if (this.roomStore?.endDrag(event)) { this.drag = null; this.dragCancelledTap = true; return; }
    if (event.pointerType === 'touch' && this.touchPoints.delete(event.pointerId)) {
      if (this.touchPoints.size >= 2) this.startPinch();
      else {
        this.pinch = null;
        const [pointerId, point] = [...this.touchPoints.entries()][0] ?? [];
        this.drag = point ? { pointerId, lastX: point.x, lastY: point.y, travelled: DRAG_THRESHOLD } : null;
      }
      this.floor.cursor = 'pointer';
      return;
    }
    if (this.drag && event.pointerId !== this.drag.pointerId) return;
    this.drag = null;
    this.floor.cursor = 'pointer';
  };

  /**
   * `ctrlKey` fica de fora de propósito: é o gesto de pinça do trackpad, e o
   * navegador já dá zoom na página com ele. O Pixi registra o listener de roda
   * como `passive`, então não há como cancelar o gesto nativo — competir com ele
   * daria zoom duplo.
   */
  private onWheel = (event: FederatedWheelEvent): void => {
    if (this.isModalOpen) return;
    if (event.ctrlKey) return;

    const passos = wheelNotches(event.deltaY, event.deltaMode);
    if (passos === 0) return;

    const focus = this.view.toLocal(event.global);
    this.zoomCameraBy(ZOOM_WHEEL_STEP ** passos, { x: focus.x, y: focus.y });
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.isModalOpen) return;

    // O painel de desenvolvimento tem campos de texto; digitar neles não é câmera.
    const alvo = event.target as HTMLElement | null;
    if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
    if (this.roomStore?.key(event)) { event.preventDefault(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'Escape' && this.storeBar?.isOpen) {
      event.preventDefault();
      this.closeStoreBar();
      return;
    }

    const passo = event.shiftKey ? PAN_KEY_STEP * 3 : PAN_KEY_STEP;

    switch (event.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        this.panCameraBy(passo, 0);
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        this.panCameraBy(-passo, 0);
        break;
      case 'ArrowUp':
      case 'w':
      case 'W':
        this.panCameraBy(0, passo);
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        this.panCameraBy(0, -passo);
        break;
      case '+':
      case '=':
        this.zoomCameraBy(ZOOM_KEY_STEP);
        break;
      case '-':
      case '_':
        this.zoomCameraBy(1 / ZOOM_KEY_STEP);
        break;
      case '0':
        this.resetCamera();
        break;
      default:
        return;
    }

    event.preventDefault();
  };

  private onPointerMove = (event: FederatedPointerEvent): void => {
    this.updateHoveredTile(event);
  };

  private updateHoveredTile(event: FederatedPointerEvent): void {
    const local = this.world.toLocal(event.global);
    const tile = screenToTile(local.x, local.y);

    // Parede estrutural sem piso não recebe hover nem destino
    if (this.model.isWallTile(tile.tx, tile.ty) && !this.model.hasFloor(tile.tx, tile.ty)) {
      this.hovered = null;
      this.highlight.clear();
      return;
    }

    const insideGrid =
      tile.tx >= TEST_GRID.minTx &&
      tile.tx <= TEST_GRID.maxTx &&
      tile.ty >= TEST_GRID.minTy &&
      tile.ty <= TEST_GRID.maxTy;

    if (!insideGrid) {
      this.hovered = null;
      this.highlight.clear();
      return;
    }
    if (this.hovered && this.hovered.tx === tile.tx && this.hovered.ty === tile.ty) return;

    this.hovered = tile;
    const isRoomFloor = this.model.hasFloor(tile.tx, tile.ty);
    const walkable = isRoomFloor && this.model.isWalkable(tile.tx, tile.ty);

    this.highlight.clear();
    if (isRoomFloor) {
      this.highlight
        .poly(tileDiamond(tile.tx, tile.ty))
        .fill({ color: walkable ? 0xffffff : 0xd23b3b, alpha: 0.22 })
        .stroke({ color: walkable ? 0xffffff : 0xd23b3b, width: 2, alpha: 0.7 });
    } else {
      // Fora da sala: destaque ciano para inspecionar calçada/rua
      this.highlight
        .poly(tileDiamond(tile.tx, tile.ty))
        .fill({ color: 0x38bdf8, alpha: 0.28 })
        .stroke({ color: 0x38bdf8, width: 2, alpha: 0.85 });
    }
    this.updateHud();
  }

  private onPointerTap = (event: FederatedPointerEvent): void => {
    if (this.storeBar?.isOpen) {
      if (this.dragCancelledTap) { this.dragCancelledTap = false; return; }
      this.roomStore?.tap(event); return;
    }
    if (this.isModalOpen || this.storeBar?.isOpen) return;

    // Arraste longo não manda ninguém andar. O `pointerup` roda antes do
    // `pointertap`, então o sinal já está posto quando chegamos aqui.
    if (this.dragCancelledTap) {
      if (!this.pinchCancelledTap) this.dragCancelledTap = false;
      return;
    }

    const local = this.world.toLocal(event.global);
    const clicked = screenToTile(local.x, local.y);

    const clickedStove = this.model.items.find(
      (item) => item.kind === 'stove' && footprintTiles(item).some((t) => t.tx === clicked.tx && t.ty === clicked.ty),
    );
    if (clickedStove) {
      this.openCookScreen(clickedStove);
      return;
    }

    this.closeStoveActions();
    this.sendPlayerTo(clicked);
  };

  /**
   * Manda o jogador até o tile pedido. Se o tile estiver ocupado, vai para o
   * vizinho livre mais próximo — é o que faz sentido ao clicar numa mesa.
   */
  sendPlayerTo(tile: Tile): Tile[] | null {
    if (this.realtime && !this.realtime.connected) return null;
    const chair = this.model.itemAt(tile.tx, tile.ty);
    if (this.realtime && chair?.kind === 'chair' && chair.inventoryUnitId) {
      void this.realtime.command('sit', { chairId: chair.inventoryUnitId }).catch((error: unknown) => console.info('[room]', error)); return [];
    }
    if (this.startingCook || this.servingProcess || (this.cookingProcess?.placementActive && this.cookingProcess.phase !== 'cooking' && this.cookingProcess.phase !== 'ready')) return null;
    // A porta é atravessável pela navegação dos NPCs, mas não tem piso nem
    // recebe clique como destino do jogador.
    if (!this.model.hasFloor(tile.tx, tile.ty)) return null;

    const destination = this.model.isWalkable(tile.tx, tile.ty) ? tile : this.nearestFreeNeighbour(tile);
    if (!destination) return null;

    const path = findPath({
      start: { tx: this.player.tileX, ty: this.player.tileY },
      dest: destination,
      isWalkable: this.model.isWalkable,
      maxTilesX: this.model.tilesX,
      maxTilesY: this.model.tilesY,
    });

    if (!path) return null;
    if (path.length === 0) {
      if (this.player.moving) {
        const current = this.player.currentDestination;
        if (this.realtime) this.movePlayerAlong([destination]);
        else if (current?.tx === destination.tx && current.ty === destination.ty) this.player.clearPath();
        else this.movePlayerAlong([destination]);
        this.drawTarget(destination);
      }
      return path;
    }

    this.movePlayerAlong(path);
    this.drawTarget(destination);
    this.updateHud();
    return path;
  }

  private nearestFreeNeighbour(tile: Tile): Tile | null {
    const candidates: Tile[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const candidate = { tx: tile.tx + dx, ty: tile.ty + dy };
        if (this.model.isWalkable(candidate.tx, candidate.ty)) candidates.push(candidate);
      }
    }
    if (candidates.length === 0) return null;

    const from = { tx: this.player.tileX, ty: this.player.tileY };
    candidates.sort(
      (a, b) =>
        Math.abs(a.tx - from.tx) +
        Math.abs(a.ty - from.ty) -
        (Math.abs(b.tx - from.tx) + Math.abs(b.ty - from.ty)),
    );
    return candidates[0];
  }

  private drawTarget(tile: Tile): void {
    this.target.clear();
    this.target
      .poly(tileDiamond(tile.tx, tile.ty))
      .stroke({ color: 0x8ce052, width: 3, alpha: 0.95 });
  }

  private updateHud(): void {
    if (!this.hud) return;
    let tileDesc = '--';
    if (this.hovered) {
      const isRoomFloor = this.model.hasFloor(this.hovered.tx, this.hovered.ty);
      tileDesc = `${this.hovered.tx},${this.hovered.ty}${isRoomFloor ? '' : ' (fora)'}`;
    }
    this.hud.text =
      `room ${this.model.tilesX}x${this.model.tilesY}  ` +
      `atores ${this.actors.length}  ` +
      `cursor ${tileDesc}\n` +
      `passos ${this.player.remainingPath.length}  ` +
      `zoom ${Math.round((this.camera.zoom / this.camera.baseZoom()) * 100)}%  ` +
      // Pixels físicos por pixel de arte. Inteiro significa sem reamostragem.
      `px ${this.camera.netScale.toFixed(2)}${this.camera.pixelPerfect ? ' exato' : ''}  ` +
      `fps ${this.fps}  ` +
      `ping ${this.realtime?.pingMs ?? '--'} ms\n` +
      GAME_VERSION;
  }

  private wander(wanderer: Wanderer, deltaMs: number): void {
    if (!wanderer.actor.reachedPathEnd()) return;

    wanderer.idleMs -= deltaMs;
    if (wanderer.idleMs > 0) return;
    wanderer.idleMs = 600 + this.random() * 2200;

    const free = this.model.walkableTiles();
    if (free.length === 0) return;
    const dest = free[Math.min(free.length - 1, Math.floor(this.random() * free.length))];

    const path = findPath({
      start: { tx: wanderer.actor.tileX, ty: wanderer.actor.tileY },
      dest,
      isWalkable: this.model.isWalkable,
      maxTilesX: this.model.tilesX,
      maxTilesY: this.model.tilesY,
    });
    if (path && path.length > 0) wanderer.actor.setMovePath(path);
  }

  /** Apply an authenticated snapshot to both HUDs without rebuilding the room. */
  setPlayerState(state: PlayerState): void {
    if (this.roomSnapshot) this.roomSnapshot.playerState = state;
    if (this.roomSnapshot?.canEdit !== false && state.level > this.knownLevel) this.celebrateLevel(state.level);
    this.topBars?.setState(state);
    this.actionBarMood?.setSatisfaction(state.satisfaction);
    this.actionBarMood?.setCafeName(state.cafeName);
    const appearance = state.appearance ?? '';
    this.wardrobeModal?.setSavedAppearance(appearance);
    if (appearance !== this.playerAppearance) {
      this.playerAppearance = appearance;
      void this.refreshPlayerAppearance(appearance);
    }
  }

  private async refreshPlayerAppearance(appearance: string): Promise<void> {
    const revision = ++this.appearanceRevision;
    if (!(this.playerView instanceof AvatarActorView)) return;
    let bundle: BakedAvatarBundle | undefined;
    try {
      const { wardrobe } = await loadAvatarAssets();
      if (this.destroyed || revision !== this.appearanceRevision) return;
      [bundle] = await bakeAvatars({ looks: [restoreAppearance(wardrobe, appearance)] });
      if (!bundle) return;
      if (this.destroyed || revision !== this.appearanceRevision) {
        bundle.texture.destroy(true);
        return;
      }
      this.playerView.setAppearance(bundle.baked, bundle.texture);
      // Initial atlases may be shared with NPCs; only replacements are owned here.
      this.appearanceAtlas?.texture.destroy(true);
      this.appearanceAtlas = bundle;
    } catch (error) {
      console.warn('[appearance] visual salvo; não foi possível atualizar o avatar da sala', error);
    }
  }

  update(deltaMs: number): void {
    this.lastDeltaMs = Math.max(0, deltaMs);
    this.fpsElapsedMs += Math.max(0, deltaMs);
    this.fpsFrames++;
    if (this.fpsElapsedMs >= 500) {
      this.fps = Math.round(this.fpsFrames * 1000 / this.fpsElapsedMs);
      this.fpsElapsedMs = 0;
      this.fpsFrames = 0;
    }
    if (this.hud) this.hud.visible = !this.cookModal?.isOpen;
    this.cookModal?.update(deltaMs);
    this.wardrobeModal?.update(deltaMs);
    this.storeBar?.update(deltaMs);
    this.topBars?.update(deltaMs);

    const hoverStep = 1 - Math.exp(-Math.max(0, deltaMs) / 38);
    for (const hover of this.actionIconHovers) {
      hover.sprite.y += (hover.targetY - hover.sprite.y) * hoverStep;
      if (Math.abs(hover.targetY - hover.sprite.y) < 0.05) hover.sprite.y = hover.targetY;
    }

    if (this.realtime) this.updateLiveActors(deltaMs); else this.player.tick(deltaMs);
    this.updateStoveActionTime();
    if (this.pendingCook && this.networkPending === 0 && this.realtime?.connected !== false && this.player.reachedPathEnd()) this.beginServerPlacement();
    if (this.cookingProcess?.phase === 'walking' && this.player.reachedPathEnd()) {
      this.beginPreparing();
    } else if (this.cookingProcess?.phase === 'preparing') {
      const process = this.cookingProcess;
      process.elapsedMs = process.preparingAtMs !== undefined && this.cookingClient
        ? Math.max(0, Math.min(process.durationMs, this.cookingClient.serverNowMs() - process.preparingAtMs))
        : Math.min(process.durationMs, process.elapsedMs + Math.max(0, deltaMs));
      process.progress?.setProgress(process.elapsedMs / process.durationMs);
      if (process.elapsedMs >= process.durationMs) this.finishPlacement();
    } else if (this.cookingProcess?.phase === 'cooking') {
      const process = this.cookingProcess;
      process.elapsedMs = process.startedAtMs !== undefined && this.cookingClient
        ? Math.max(0, Math.min(process.durationMs, this.cookingClient.serverNowMs() - process.startedAtMs))
        : Math.min(process.durationMs, process.elapsedMs + Math.max(0, deltaMs));
      if (process.elapsedMs >= process.durationMs) this.finishCooking();
    }
    this.updateCookingCallout();
    if (this.servingProcess?.phase === 'walking' && this.networkPending === 0 && this.realtime?.connected !== false && this.player.reachedPathEnd()) {
      this.beginServing();
    } else if (this.servingProcess?.phase === 'serving') {
      const process = this.servingProcess;
      const duration = process.durationMs ?? LOCAL_COOKING_PREVIEW_MS;
      process.elapsedMs = process.startedAtMs !== undefined && this.realtime
        ? Math.max(0, Math.min(duration, this.realtime.serverNowMs() - process.startedAtMs))
        : Math.min(duration, process.elapsedMs + Math.max(0, deltaMs));
      process.progress?.setProgress(process.elapsedMs / duration);
      if (process.elapsedMs >= duration) this.finishServing();
    }
    if (!this.realtime) this.advanceActorView(this.playerView, deltaMs);

    for (const wanderer of this.wanderers) {
      this.wander(wanderer, deltaMs);
      wanderer.actor.tick(deltaMs);
      this.advanceActorView(wanderer.view, deltaMs);
    }

    this.outsideNpcManager?.update(deltaMs);
    this.updateStreet();
    this.showPendingAway();
    this.showPendingDaily();
    this.welcomeBack?.update(deltaMs);
    this.confirmDialog.update(deltaMs);
    this.dailyModal?.update(deltaMs);
    this.mailModal?.update(deltaMs);
    this.streetScenery?.update(deltaMs);
    this.partyLights.update(deltaMs);
    this.partyBadge.update(deltaMs);
    this.streetModal?.update();
    if (this.tableCleaning?.phase === 'walking' && this.networkPending === 0 && this.realtime?.connected !== false && this.player.reachedPathEnd()) {
      this.requestTableClean();
    }
    this.floatingRewards.update(deltaMs, !this.storeBar?.isOpen);
    this.levelUpToast.update(deltaMs);
    this.levelUpModal?.update(deltaMs);
    for (let i = this.expansionGlows.length - 1; i >= 0; i--) {
      const glow = this.expansionGlows[i]!;
      glow.update(deltaMs);
      glow.view.renderable = !this.storeBar?.isOpen;
      if (glow.done) { glow.destroy(); this.expansionGlows.splice(i, 1); }
    }
    this.audioControl?.update();
    this.updateRushIntensity();
    if (this.doorViews.length) {
      const actors = this.actors;
      for (const door of this.doorViews) door.update(deltaMs, actors);
    }
    this.depthSorter.sync(this.world);
    for (const [id, emotion] of this.liveEmotions) {
      const actor = this.liveActors.get(id);
      if (actor) emotion.effect.sync(actor.view.view);
    }
    for (const npc of this.outsideNpcManager?.npcs ?? []) npc.emotion?.sync(npc.view.view);

    if (this.hud) this.updateHud();
  }

  /** Two customers inside start the rush, four is full intensity; a dish about to spoil also hurries the music. */
  private updateRushIntensity(): void {
    if (!this.audio || !this.realtime) return;
    let inside = 0;
    for (const { state } of this.liveActors.values()) if (state.kind === 'npc' && !state.outside) inside++;
    const rush = Math.max(0, Math.min(1, (inside - 1) / 3));
    const intensity = Math.max(rush, this.stovesUrgent ? 0.8 : 0, this.partyOn ? 1 : 0);
    if (intensity === this.rushIntensity) return;
    this.rushIntensity = intensity;
    this.audio.setIntensity(intensity);
  }

  private advanceActorView(view: ActorRenderer, deltaMs: number): void {
    if (view.update) view.update(deltaMs);
    else view.sync();
  }

  private get isMobileLandscape(): boolean {
    return typeof window !== 'undefined' &&
      window.innerWidth > window.innerHeight &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;
  }

  private updateMobileHudLayout(): void {
    const scale = this.isMobileLandscape ? MOBILE_LANDSCAPE_HUD_SCALE : 1;
    if (this.topBars) {
      this.topBars.view.scale.set(scale);
      this.topBars.view.x = (STAGE_WIDTH - this.topBarsBaseWidth * scale) / 2;
    }
    // Scale complete toolbars around their bottom-center pivots, including all contents.
    const actionBarScale = scale * ACTION_BAR_UI_SCALE;
    this.actionBarLayer.scale.set(actionBarScale);
    this.storeBar?.setHudScale(actionBarScale);
  }

  /**
   * Escala do letterbox. Serve para duas coisas: reamostrar o texto do HUD e
   * dizer à câmera quantos pixels físicos existem por pixel de stage, que é o que
   * permite ela desfazer a reamostragem da arte.
   */
  setStageScale(scale: number): void {
    this.wardrobeModal?.setStageScale(scale);
    this.settingsModal?.setStageScale(scale);
    this.staffModal?.setStageScale(scale);
    this.levelUpModal?.setStageScale(scale);
    this.expansionModal?.setStageScale(scale);
    this.streetModal?.setStageScale(scale);
    this.welcomeBack?.setStageScale(scale);
    this.confirmDialog.setStageScale(scale);
    this.dailyModal?.setStageScale(scale);
    this.mailModal?.setStageScale(scale);
    this.audioControl?.setStageScale(scale);
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

    this.outerScale = scale * dpr;
    this.camera.setPixelScale(this.outerScale);
    const background = this.artProvider?.art.sceneBackground;
    if (this.isMobileLandscape && background) {
      const tiles = background.tiles ?? [background];
      const overhang = scale > 0 ? Math.max(0, (window.innerWidth / scale - STAGE_WIDTH) / 2) : 0;
      this.camera.setHorizontalCover({
        left: Math.min(...tiles.map((tile) => tile.left)),
        right: Math.max(...tiles.map((tile) => tile.left + tile.width)),
        viewportLeft: -overhang,
        viewportRight: STAGE_WIDTH + overhang,
      });
    } else {
      this.camera.setHorizontalCover(null);
    }
    this.applyCamera();
    this.updateMobileHudLayout();

    if (this.hud) {
      this.hud.resolution = Math.min(4, Math.max(1, this.outerScale));
      this.updateHud();
    }
  }

  destroy(): void {
    clearTimeout(this.noticeTimer);
    this.realtime?.destroy();
    for (const [id, entry] of this.liveActors) this.removeLiveActor(id, entry);
    this.liveActors.clear(); this.mealViews.clear();
    this.sharedCookingViews.forEach((view) => view.destroy()); this.sharedCookingViews.clear();
    this.sharedCookingProgress.forEach(({ bar }) => bar.destroy()); this.sharedCookingProgress.clear();
    this.liveEmotions.forEach(({ effect }) => effect.destroy()); this.liveEmotions.clear();
    this.floatingRewards.destroy();
    this.levelUpToast.destroy();
    this.audioControl?.destroy();
    this.counterDishes.forEach((dish) => dish.destroy()); this.counterDishes.clear();
    this.stoveEffects.forEach((effects) => effects.destroy()); this.stoveEffects.clear();
    this.patienceMeters.forEach((meter) => meter.destroy()); this.patienceMeters.clear();
    this.tableDirt.forEach((view) => view.destroy()); this.tableDirt.clear();
    this.recipeArt.destroy();
    this.streetScenery?.destroy();
    this.roomStore?.destroy();
    this.destroyed = true;
    this.closeStoveActions();
    this.cookCallout?.destroy();
    this.clearServingProcess();
    this.storeBar?.destroy();
    this.topBars?.destroy();
    this.clearCookingProcess();
    this.cookModal?.destroy();
    this.wardrobeModal?.destroy();
    this.settingsModal?.destroy();
    this.staffModal?.destroy();
    this.levelUpModal?.destroy();
    this.expansionModal?.destroy();
    this.streetModal?.destroy();
    this.welcomeBack?.destroy();
    this.confirmDialog.destroy();
    this.dailyModal?.destroy();
    this.mailModal?.destroy();
    this.partyLights.destroy();
    this.partyBadge.destroy();
    this.audio?.setOverride?.(null);
    this.expansionGlows.splice(0).forEach((glow) => glow.destroy());
    this.trayDishes.forEach((dish) => { if (!dish.destroyed) dish.destroy(); }); this.trayDishes.clear();
    this.outsideNpcManager?.destroy();
    this.npcAvatarSource?.destroy();
    this.npcAvatarIndices.clear();
    this.playerView.destroy();
    this.appearanceAtlas?.texture.destroy(true);
    this.floor.off('pointermove', this.onPointerMove);
    this.floor.off('pointertap', this.onPointerTap);
    for (const alvo of [this.floor, this.backdrop]) {
      alvo.off('pointerdown', this.onDragStart);
      alvo.off('pointerup', this.onDragEnd);
      alvo.off('pointerupoutside', this.onDragEnd);
      alvo.off('wheel', this.onWheel);
    }
    this.backdrop.off('globalpointermove', this.onDragMove);
    if (this.keyboardCamera && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
    }
    this.view.destroy({ children: true });
  }
}

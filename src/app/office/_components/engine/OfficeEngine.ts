import * as THREE from "three";
import {
  BUILDING,
  CATALOG_BY_ID,
  DEMO_USERS,
  FURNITURE_CATALOG,
  ROOM_BY_ID,
  ROOMS,
  SEAT_HEIGHT,
  type AvatarConfig,
  type DemoUser,
  type FurnitureItem,
  type OfficeRoom,
  type PresenceStatus,
  furnitureAabb,
  validatePlacement,
} from "../office-data";
import { floorLayoutItems, roomLayoutItems } from "../office-layout";
import type { OfficeFloor, OfficeOccupant } from "~/types/office";
import { TowerScene, type TowerOffice } from "./tower-scene";
import { INK_CSS, PALETTE, PAPER_CSS } from "./palette";

export interface EngineCallbacks {
  onReady: () => void;
  onError: (message: string) => void;
  onRoomChange: (room: OfficeRoom | null) => void;
  onPosition: (x: number, z: number, yaw: number) => void;
  onZoeProximity: (near: boolean) => void;
  onFurnitureSelect: (id: string | null) => void;
  onRequestPlace: (x: number, z: number) => void;
  onRequestMove: (id: string, x: number, z: number) => void;
  onPresence: (
    users: Array<{
      id: string;
      x: number;
      z: number;
      roomId: string;
      status: PresenceStatus;
    }>
  ) => void;
  onInvalidTarget: () => void;
  /** Live feedback for the placement ghost (valid / why it is not). */
  onGhostState?: (valid: boolean, reason: string | null) => void;
  /** A person's office was clicked in the tower. */
  onTowerPick?: (office: { roomId: string; floorIndex: number }) => void;
  /** What the pointer is over in the tower, for the hover card. */
  onTowerHover?: (office: TowerOffice | null) => void;
  /** The floor the 3D interior is showing changed. */
  onFloorChange?: (floorIndex: number) => void;
}

export interface EditState {
  active: boolean;
  catalogId: string | null;
  movingId: string | null;
  movingCatalogId?: string | null;
  rotation: number;
}

interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface AvatarRig {
  group: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  torso: THREE.Mesh;
  ring: THREE.Mesh;
  phase: number;
  bubble?: {
    sprite: THREE.Sprite;
    material: THREE.SpriteMaterial;
    texture: THREE.CanvasTexture;
    until: number;
  };
}

interface AgentState {
  rig: AvatarRig;
  user: DemoUser;
  targetIndex: number;
  pauseUntil: number;
  speed: number;
  lastRoomId: string;
}

interface PathNode {
  x: number;
  z: number;
  g: number;
  f: number;
  parent: PathNode | null;
}

const STATUS_COLORS: Record<PresenceStatus, number> = {
  online: 0x34d399,
  idle: 0xf59e0b,
  away: 0x94a3b8,
  call: 0x60a5fa,
  dnd: 0xf43f5e,
};

// The two wings overlap around x=43.6 so the private-wing doorway (z=24.2..25.8)
// stays walkable; the wall collider still blocks every other spot.
const WALK_BOUNDS = [
  { minX: 0.4, maxX: 44.6, minZ: 0.4, maxZ: 35.6 },
  { minX: 42.9, maxX: 55.6, minZ: 8.4, maxZ: 35.6 },
];

const ZOE_POS = { x: 8.5, z: 3.2 };

// The interior is a lit building rather than a cave: this is the colour of the
// light coming off cream plaster and a waxed wood floor, and it is what the
// far end of a corridor fades into.
const INTERIOR_BACKDROP = 0xe9e2d4;

// The live building's footprint is derived from the rooms the server sends, so
// the walking bounds follow the floor plan instead of the demo's two wings.
const DEMO_PLAN = {
  minX: 0,
  maxX: BUILDING.maxX,
  minZ: 0,
  maxZ: BUILDING.maxZ,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function skinTone(seed: string): number {
  const tones = [0xf1c7a5, 0xd9a066, 0xa86b3d, 0x7a4a2b, 0x5a3520, 0xe8b990];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1)
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return tones[hash % tones.length];
}

function hairColor(seed: string): number {
  const colors = [0x1b1526, 0x2d1f14, 0x4a2c18, 0x0e0e14, 0x6b3f24];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1)
    hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  return colors[hash % colors.length];
}

function makeCanvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * The three floor finishes the reference building uses. A tile is one metre,
 * so a 5 by 5.4 office reads as eleven oak boards rather than one stretched
 * gradient.
 */
function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

type FloorFinish = "wood" | "carpet" | "terrazzo";

/** Rooms you can shut a door on; everything else is an open zone on the plan. */
function isClosedRoom(kind: OfficeRoom["kind"]): boolean {
  return kind === "personal" || kind === "meeting" || kind === "focus";
}

function floorFinish(kind: string): FloorFinish {
  if (kind === "personal" || kind === "focus" || kind === "meeting") {
    return "wood";
  }
  if (kind === "channel" || kind === "lounge" || kind === "reception") {
    return "carpet";
  }
  return "terrazzo";
}

function makeFloorTexture(finish: FloorFinish): THREE.CanvasTexture {
  const base = css(
    finish === "wood"
      ? PALETTE.wood
      : finish === "carpet"
        ? PALETTE.carpet
        : PALETTE.terrazzo
  );
  const seam = css(
    finish === "wood"
      ? PALETTE.woodDark
      : finish === "carpet"
        ? PALETTE.site
        : PALETTE.stone
  );

  return makeCanvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 128, 128);

    if (finish === "terrazzo") {
      // Aggregate speckle: four greys scattered over a pale binder.
      const chips = [
        seam,
        css(PALETTE.stone),
        css(PALETTE.accent),
        css(PALETTE.slab),
      ];
      for (let i = 0; i < 130; i += 1) {
        const t = noise2(i * 7.13) * 128;
        const u = noise2(i * 3.71 + 91) * 128;
        ctx.fillStyle = chips[i % chips.length];
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(t, u, 1 + noise2(i * 1.9) * 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = css(PALETTE.slab);
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, 128, 128);
      ctx.beginPath();
      ctx.moveTo(64, 0);
      ctx.lineTo(64, 128);
      ctx.moveTo(0, 64);
      ctx.lineTo(128, 64);
      ctx.stroke();
      return;
    }

    if (finish === "carpet") {
      // Tufted tiles: a light grid with a speckled pile inside each square.
      for (let i = 0; i < 900; i += 1) {
        ctx.fillStyle = i % 2 ? css(PALETTE.wallShade) : css(PALETTE.slab);
        ctx.globalAlpha = 0.16;
        ctx.fillRect(
          noise2(i * 5.31) * 126,
          noise2(i * 2.17 + 13) * 126,
          1.4,
          1.4
        );
      }
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = seam;
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, 128, 128);
      ctx.beginPath();
      ctx.moveTo(64, 0);
      ctx.lineTo(64, 128);
      ctx.moveTo(0, 64);
      ctx.lineTo(128, 64);
      ctx.stroke();
      return;
    }

    // Oak boards: eight planks per tile with a butt joint every fourth one.
    ctx.globalAlpha = 1;
    for (let row = 0; row < 8; row += 1) {
      const y = row * 16;
      ctx.fillStyle = css(
        noise2(row * 11.3) > 0.62 ? PALETTE.desk : PALETTE.wood
      );
      ctx.globalAlpha = 0.35;
      ctx.fillRect(0, y, 128, 16);
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = seam;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(128, y + 0.5);
      ctx.stroke();
      const joint = ((row % 4) * 32 + 16) % 128;
      ctx.beginPath();
      ctx.moveTo(joint, y);
      ctx.lineTo(joint, y + 16);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = css(PALETTE.woodDark);
    ctx.lineWidth = 1;
    for (let i = 0; i < 26; i += 1) {
      const y = noise2(i * 4.7) * 128;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(42, y + 3, 86, y - 3, 128, y);
      ctx.stroke();
    }
  });
}

function noise2(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function floorTextureCache(): Record<FloorFinish, THREE.CanvasTexture> {
  if (!cachedFloorTextures) {
    cachedFloorTextures = {
      wood: makeFloorTexture("wood"),
      carpet: makeFloorTexture("carpet"),
      terrazzo: makeFloorTexture("terrazzo"),
    };
    for (const texture of Object.values(cachedFloorTextures)) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
    }
  }
  return cachedFloorTextures;
}

let cachedFloorTextures: Record<FloorFinish, THREE.CanvasTexture> | null = null;

/** A cloned, repeat-fitted tile so each room keeps its own scale. */
function floorTextureFor(kind: string, w: number, d: number): THREE.Texture {
  const texture = floorTextureCache()[floorFinish(kind)].clone();
  texture.needsUpdate = true;
  texture.repeat.set(Math.max(0.5, w), Math.max(0.5, d));
  return texture;
}

/** A name card the size of the one a building hangs beside a door. */
function makePlaqueTexture(
  label: string,
  accent: string,
  locked: boolean
): THREE.CanvasTexture {
  return makeCanvasTexture(256, 72, (ctx) => {
    ctx.clearRect(0, 0, 256, 72);
    ctx.fillStyle = PAPER_CSS;
    roundRect(ctx, 4, 6, 248, 60, 10);
    ctx.fill();
    ctx.strokeStyle = locked ? "#7f1d3a" : accent;
    ctx.lineWidth = 3;
    roundRect(ctx, 4, 6, 248, 60, 10);
    ctx.stroke();
    ctx.fillStyle = INK_CSS;
    ctx.font = "800 26px Lato, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 128, 30);
    ctx.fillStyle = accent;
    ctx.fillRect(88, 50, 80, 4);
    if (locked) {
      ctx.fillStyle = "#7f1d3a";
      ctx.fillRect(18, 26, 12, 14);
      ctx.strokeStyle = "#7f1d3a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(24, 26, 5, Math.PI, 0);
      ctx.stroke();
    }
  });
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach((material) => {
        const map = (material as THREE.MeshStandardMaterial).map;
        map?.dispose();
        material.dispose();
      });
    }
    if (child instanceof THREE.Sprite) {
      child.material.map?.dispose();
      child.material.dispose();
    }
  });
}

export class OfficeEngine {
  private container: HTMLDivElement;
  private callbacks: EngineCallbacks;
  private isMobile: boolean;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private resizeObserver: ResizeObserver | null = null;

  private buildingGroup = new THREE.Group();
  private staticGroup = new THREE.Group();
  private furnitureGroup = new THREE.Group();
  private avatarGroup = new THREE.Group();
  private ghostGroup = new THREE.Group();

  private colliders: Collider[] = [];
  private wallColliders: Collider[] = [];
  private staticColliders: Collider[] = [];
  private furnitureColliders: Collider[] = [];

  private cameraYaw = 0;
  private cameraPitch = 0.86;
  private cameraDistance = 9;
  private cameraTarget = new THREE.Vector3(8.5, 1.1, 9.4);
  private cameraPosition = new THREE.Vector3(8.5, 7, 18);
  private cinematic = true;
  private cinemaTime = 0;

  private keys = new Set<string>();
  private joystick = new THREE.Vector2();
  private playerPosition = new THREE.Vector3(8.5, 0, 9.4);
  private playerYaw = Math.PI;
  private playerVelocity = new THREE.Vector2();
  private playerSpeed = 0;
  private path: Array<{ x: number; z: number }> = [];
  private pathIndex = 0;
  private lastInputAt = 0;
  /** The seat the player is sitting on, and the one they are walking to. */
  private seated: THREE.Object3D | null = null;
  private pendingSeat: THREE.Object3D | null = null;

  private playerRig: AvatarRig | null = null;
  private playerStatus: PresenceStatus = "online";
  private currentRoom: OfficeRoom | null = ROOM_BY_ID.reception;
  private nearZoe = false;
  private rooms: OfficeRoom[] = ROOMS;
  private allRooms: OfficeRoom[] = ROOMS;
  private activeFloor = 0;
  private planBounds = DEMO_PLAN;
  private walkBounds: Collider[] = WALK_BOUNDS;
  private zoePosition = { ...ZOE_POS };
  private view: "floor" | "tower" = "floor";
  private tower: TowerScene | null = null;
  private towerFloors: OfficeFloor[] = [];
  private towerOffices: TowerOffice[] = [];
  private skyTexture: THREE.Texture | null = null;

  private agentRigs = new Map<string, AvatarRig>();
  private isLive = false;
  private selfId = "you";

  /**
   * The building can run on the demo floor plan or on the rooms the office API
   * derives from an organisation's channels, direct messages and people.
   */
  setRooms(rooms: OfficeRoom[]) {
    if (!rooms.length) return;
    const previous = this.rooms;
    this.allRooms = rooms;
    const next = this.roomsOnFloor(this.activeFloor);
    this.rooms = next;
    this.updatePlan();
    this.syncZoe();
    const unchanged =
      next.length === previous.length &&
      next.every((room, index) => room === previous[index]);
    if (!unchanged) this.rebuildFloorContent();
    this.ensureSpawn();
  }

  /**
   * Derive the walkable footprint from the rooms on the floor that is being
   * shown. Every storey has its own plan, so the bounds are recomputed when the
   * user changes floor instead of being inherited from the general floor.
   */
  private updatePlan() {
    if (!this.isLive) {
      this.planBounds = DEMO_PLAN;
      this.walkBounds = WALK_BOUNDS;
      const cx = (DEMO_PLAN.minX + DEMO_PLAN.maxX) / 2;
      const cz = (DEMO_PLAN.minZ + DEMO_PLAN.maxZ) / 2;
      this.floorPlane.position.set(cx, 0, cz);
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const room of this.rooms) {
      minX = Math.min(minX, room.bounds.x);
      maxX = Math.max(maxX, room.bounds.x + room.bounds.w);
      minZ = Math.min(minZ, room.bounds.z);
      maxZ = Math.max(maxZ, room.bounds.z + room.bounds.d);
    }
    if (!Number.isFinite(minX)) return;

    const pad = 1.4;
    this.planBounds = {
      minX: minX - pad,
      maxX: maxX + pad,
      minZ: minZ - pad,
      maxZ: maxZ + pad,
    };
    this.walkBounds = [
      {
        minX: this.planBounds.minX + 0.5,
        maxX: this.planBounds.maxX - 0.5,
        minZ: this.planBounds.minZ + 0.5,
        maxZ: this.planBounds.maxZ - 0.5,
      },
    ];
    this.floorPlane.position.set(
      (this.planBounds.minX + this.planBounds.maxX) / 2,
      0,
      (this.planBounds.minZ + this.planBounds.maxZ) / 2
    );
  }

  private get planCenter() {
    return {
      x: (this.planBounds.minX + this.planBounds.maxX) / 2,
      z: (this.planBounds.minZ + this.planBounds.maxZ) / 2,
    };
  }

  private get planWidth() {
    return this.planBounds.maxX - this.planBounds.minX;
  }

  private get planDepth() {
    return this.planBounds.maxZ - this.planBounds.minZ;
  }

  /** Zoe stands behind reception, wherever the server put reception. */
  private syncZoe() {
    const room =
      this.allRooms.find((item) => item.kind === "reception") ??
      this.allRooms.find((item) => item.kind === "lobby");
    if (!room) return;
    this.zoePosition = {
      x: room.bounds.x + room.bounds.w / 2,
      z: room.bounds.z + Math.min(2.1, room.bounds.d * 0.32),
    };
    if (this.zoeRig) {
      this.zoeRig.group.position.set(this.zoePosition.x, 0, this.zoePosition.z);
      this.zoeRig.group.rotation.y = Math.PI;
    }
    const range = this.buildingGroup.getObjectByName("zoe-range");
    if (range) {
      range.position.set(this.zoePosition.x, 0.02, this.zoePosition.z);
    }
  }

  /** The live layout can change under the player; never leave them in a wall. */
  private ensureSpawn() {
    if (!this.isLive) return;
    if (!this.isBlocked(this.playerPosition.x, this.playerPosition.z, 0.34)) {
      return;
    }
    const room =
      this.rooms.find((item) => item.kind === "reception") ??
      this.rooms.find((item) => item.kind === "lobby") ??
      this.rooms.find((item) => item.kind !== "area") ??
      this.rooms[0];
    if (!room) return;
    this.playerPosition.set(room.spawn.x, 0, room.spawn.z);
    this.playerYaw = Math.PI;
    this.path = [];
    this.playerVelocity.set(0, 0);
    this.cameraTarget.set(room.spawn.x, 1.25, room.spawn.z);
    this.playerRig?.group.position.set(room.spawn.x, 0, room.spawn.z);
  }

  private roomsOnFloor(index: number): OfficeRoom[] {
    return this.allRooms.filter((room) => (room.floorIndex ?? 0) === index);
  }

  /** Give the tower the floor directory and the people who sit in it. */
  setTower(floors: OfficeFloor[], offices: TowerOffice[]) {
    this.towerFloors = floors;
    this.towerOffices = offices;
    this.tower?.setData(floors, offices);
  }

  /** Update who is in which office without rebuilding the tower. */
  setTowerOffices(offices: TowerOffice[]) {
    this.towerOffices = offices;
    if (this.view === "tower") {
      this.tower?.setData(this.towerFloors, offices);
    }
  }

  setView(view: "floor" | "tower") {
    if (this.view === view) return;
    this.view = view;
    this.towerPointer = null;
    this.setTowerHover(null);
    this.applyBackdrop(view);

    const floorGroups = [
      this.buildingGroup,
      this.staticGroup,
      this.furnitureGroup,
      this.avatarGroup,
      this.ghostGroup,
    ];

    if (view === "tower") {
      if (!this.tower) {
        this.tower = new TowerScene();
        this.tower.group.visible = false;
        this.scene.add(this.tower.group);
        this.tower.setData(this.towerFloors, this.towerOffices);
      }
      this.tower.setData(this.towerFloors, this.towerOffices);
      this.tower.group.visible = true;
      for (const group of floorGroups) group.visible = false;
      this.path = [];
      this.playerVelocity.set(0, 0);
      return;
    }

    this.tower && (this.tower.group.visible = false);
    for (const group of floorGroups) group.visible = true;
    this.cinematic = false;
  }

  /**
   * The tower is seen from the street, so it gets a daylight sky. The floor is
   * a lit interior: the backdrop is the light coming off cream plaster and a
   * waxed wood floor, and the fog only has to soften the far end of a corridor.
   */
  private applyBackdrop(view: "floor" | "tower") {
    if (view === "tower") {
      this.scene.background = this.skyTexture ?? this.createSkyTexture();
      this.scene.fog = new THREE.Fog(0xd3e6f7, 90, 260);
      return;
    }
    this.scene.background = new THREE.Color(INTERIOR_BACKDROP);
    this.scene.fog = new THREE.Fog(INTERIOR_BACKDROP, 90, 230);
  }

  private createSkyTexture(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, "#7fb2e0");
      gradient.addColorStop(0.55, "#c7def4");
      gradient.addColorStop(1, "#f2f8ff");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.skyTexture = texture;
    return texture;
  }

  /** Show a floor of the 3D interior, rebuilding only that floor's rooms. */
  setActiveFloor(index: number) {
    if (index === this.activeFloor) return;
    this.activeFloor = index;
    this.rooms = this.roomsOnFloor(index);
    this.updatePlan();
    this.rebuildFloorContent();
    this.callbacks.onFloorChange?.(index);
  }

  getActiveFloor() {
    return this.activeFloor;
  }

  /** Fly into a person's office: switch floor, then stand at its door. */
  focusRoom(roomId: string) {
    const room = this.allRooms.find((item) => item.id === roomId);
    if (!room) {
      this.callbacks.onInvalidTarget();
      return;
    }
    if ((room.floorIndex ?? 0) !== this.activeFloor) {
      this.setActiveFloor(room.floorIndex ?? 0);
    }
    this.playerPosition.set(room.spawn.x, 0, room.spawn.z);
    this.playerYaw = Math.PI;
    this.path = [];
    this.playerVelocity.set(0, 0);
    this.currentRoom = room;
    this.lastRoomCheck = 0;
    this.cameraTarget.set(room.spawn.x, 1.1, room.spawn.z);
    this.cameraPosition.set(room.spawn.x, 6, room.spawn.z + 8);
    this.playerRig?.group.position.set(room.spawn.x, 0, room.spawn.z);
    this.callbacks.onRoomChange(room);
    this.pushPosition(true);
  }

  /** Pulse a person's office in the tower, e.g. after a search. */
  pulseOffice(roomId: string, floorIndex: number | null) {
    if (!this.tower) return;
    this.tower.pulse(roomId);
    if (floorIndex !== null) this.focusTowerFloor(floorIndex);
  }

  /** Frame one storey of the tower, or the whole tower when null. */
  focusTowerFloor(index: number | null) {
    this.setTowerHover(null);
    this.tower?.focusFloor(index);
  }

  /** Frame one office: the camera pans along the facade to reach it. */
  focusTowerRoom(roomId: string | null) {
    this.setTowerHover(null);
    this.tower?.focusRoom(roomId);
  }

  private roomAtPosition(x: number, z: number): OfficeRoom | null {
    for (const room of this.rooms) {
      const b = room.bounds;
      if (x >= b.x && x <= b.x + b.w && z >= b.z && z <= b.z + b.d) {
        return room;
      }
    }
    return null;
  }

  private agents: AgentState[] = [];
  private zoeRig: AvatarRig | null = null;
  private furnitureMeshes = new Map<string, THREE.Mesh>();
  private furnitureItems: FurnitureItem[] = [];
  private labelSprites: THREE.Sprite[] = [];
  private floorLights: THREE.PointLight[] = [];
  /** Where the downlights were placed, so a short walk does not rebuild them. */
  private lightsAnchor = { x: 0, z: 0 };
  private selectedId: string | null = null;
  private selectionHelper: THREE.BoxHelper | null = null;

  private editState: EditState = {
    active: false,
    catalogId: null,
    movingId: null,
    rotation: 0,
  };
  private ghostMesh: THREE.Mesh | null = null;
  private ghostPoint: { x: number; z: number } | null = null;
  private ghostValid = true;
  private ghostReason: string | null = null;
  private lastGhostState = "";

  private towerPointer: { x: number; y: number } | null = null;
  private towerHover: TowerOffice | null = null;
  private pointerDown = false;
  private pointerStart = { x: 0, y: 0 };
  private pointerDragged = false;

  private lastPresencePush = 0;
  private lastPositionPush = 0;
  private lastRoomCheck = 0;
  private marker: THREE.Mesh | null = null;
  private markerUntil = 0;

  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private floorPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshBasicMaterial({ visible: false })
  );

  private boundKeyDown: (event: KeyboardEvent) => void;
  private boundKeyUp: (event: KeyboardEvent) => void;
  private boundPointerDown: (event: PointerEvent) => void;
  private boundPointerMove: (event: PointerEvent) => void;
  private boundPointerUp: (event: PointerEvent) => void;
  private boundPointerLeave: () => void;
  private boundWheel: (event: WheelEvent) => void;
  private boundResize: () => void;

  constructor(
    container: HTMLDivElement,
    callbacks: EngineCallbacks,
    options?: {
      isMobile?: boolean;
      cinematic?: boolean;
      isLive?: boolean;
      avatar?: AvatarConfig;
      furniture?: FurnitureItem[];
      /** Real rooms, known up front so the first frame is the real building. */
      rooms?: OfficeRoom[];
      /** The signed-in person, so presence never draws a second self. */
      selfId?: string;
    }
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.isMobile = Boolean(options?.isMobile);
    this.isLive = Boolean(options?.isLive);
    if (options?.selfId) this.selfId = options.selfId;
    // The engine opens on the cinematic orbit. Callers that drop the user
    // straight into the office pass false so control is never withheld.
    this.cinematic = options?.cinematic ?? true;

    if (options?.rooms?.length) {
      this.allRooms = options.rooms;
      this.rooms = this.roomsOnFloor(0);
      this.updatePlan();
      this.syncZoe();
      const entrance =
        this.rooms.find((room) => room.kind === "reception") ??
        this.rooms.find((room) => room.kind === "lobby");
      if (entrance) {
        this.playerPosition.set(entrance.spawn.x, 0, entrance.spawn.z);
        this.cameraTarget.set(entrance.spawn.x, 1.25, entrance.spawn.z);
        this.currentRoom = entrance;
      }
    }

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.isMobile ? 1.5 : 2)
    );
    this.renderer.shadowMap.enabled = !this.isMobile;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";
    this.renderer.domElement.setAttribute("role", "application");
    this.renderer.domElement.setAttribute(
      "aria-label",
      "3D office view. Click the floor to walk, or to place furniture in furnish mode."
    );
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(INTERIOR_BACKDROP);
    this.scene.fog = new THREE.Fog(INTERIOR_BACKDROP, 58, 150);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 240);
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraTarget);

    this.floorPlane.rotation.x = -Math.PI / 2;
    this.floorPlane.position.set(this.planCenter.x, 0, this.planCenter.z);

    this.scene.add(
      this.buildingGroup,
      this.staticGroup,
      this.furnitureGroup,
      this.avatarGroup,
      this.ghostGroup,
      this.floorPlane
    );

    this.boundKeyDown = (event) => this.onKeyDown(event);
    this.boundKeyUp = (event) => this.onKeyUp(event);
    this.boundPointerDown = (event) => this.onPointerDown(event);
    this.boundPointerMove = (event) => this.onPointerMove(event);
    this.boundPointerUp = (event) => this.onPointerUp(event);
    this.boundPointerLeave = () => {
      this.towerPointer = null;
      this.setTowerHover(null);
    };
    this.boundWheel = (event) => this.onWheel(event);
    this.boundResize = () => this.resize();

    this.build();
    if (options?.avatar) this.setAvatar(options.avatar);
    if (options?.furniture) this.setFurniture(options.furniture);

    window.addEventListener("keydown", this.boundKeyDown);
    window.addEventListener("keyup", this.boundKeyUp);
    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.boundPointerDown
    );
    this.renderer.domElement.addEventListener(
      "pointerleave",
      this.boundPointerLeave
    );
    window.addEventListener("pointermove", this.boundPointerMove);
    window.addEventListener("pointerup", this.boundPointerUp);
    this.renderer.domElement.addEventListener("wheel", this.boundWheel, {
      passive: false,
    });
    window.addEventListener("resize", this.boundResize);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.container);
    }

    this.resize();
    this.callbacks.onReady();
    this.loop();
  }

  // ---------------------------------------------------------------- public API

  setAvatar(config: AvatarConfig) {
    if (this.playerRig) {
      this.avatarGroup.remove(this.playerRig.group);
      disposeObject(this.playerRig.group);
    }
    this.playerRig = this.createAvatar(
      config,
      "You",
      "you",
      this.playerStatus,
      false,
      true
    );
    this.playerRig.group.position.set(
      this.playerPosition.x,
      0,
      this.playerPosition.z
    );
    this.playerRig.group.rotation.y = this.playerYaw;
    this.avatarGroup.add(this.playerRig.group);
  }

  setFurniture(items: FurnitureItem[]) {
    this.furnitureItems = items;
    this.renderFurniture();
  }

  /**
   * Only the furniture of rooms on the floor being shown is drawn: offices on
   * different member floors share the same coordinates, so the room id on the
   * item decides, not the position alone.
   */
  private visibleFurniture(): FurnitureItem[] {
    if (!this.isLive) return this.furnitureItems;
    return floorLayoutItems(this.furnitureItems, this.rooms);
  }

  private renderFurniture() {
    this.clearFurniture();
    this.furnitureColliders = [];
    for (const item of this.visibleFurniture()) {
      const mesh = this.buildFurniture(item);
      if (!mesh) continue;
      mesh.userData.furnitureId = item.id;
      this.furnitureMeshes.set(item.id, mesh);
      this.furnitureGroup.add(mesh);

      const catalog = CATALOG_BY_ID[item.catalogId];
      if (catalog?.collision) {
        this.furnitureColliders.push(furnitureAabb(item));
      }
    }
    this.rebuildColliders();
    this.refreshSelection();
  }

  // Reconciles the roster of other people in the office. Called from the
  // live source whenever the roster changes (join, update, leave).
  setOccupants(occupants: OfficeOccupant[]) {
    const next = new Map<string, AvatarRig>();

    // Create or update rigs for occupants that are present.
    for (const occ of occupants) {
      if (occ.userId === this.selfId || occ.userId === "you") continue; // self is rendered separately

      let rig = this.agentRigs.get(occ.userId);
      if (!rig) {
        rig = this.createAvatar(
          occ.avatar,
          occ.displayName,
          occ.username,
          occ.status,
          false,
          false
        );
        this.agentRigs.set(occ.userId, rig);
        this.avatarGroup.add(rig.group);
      }

      rig.group.position.set(occ.position.x, 0, occ.position.z);
      rig.group.rotation.y = occ.rotation ?? 0;
      this.updateRigStatus(rig, occ.status);
      next.set(occ.userId, rig);
    }

    // Dispose rigs for users who left.
    for (const [id, rig] of this.agentRigs) {
      if (!next.has(id)) {
        this.avatarGroup.remove(rig.group);
        disposeObject(rig.group);
        this.agentRigs.delete(id);
      }
    }

    // Keep the agents array in sync for any downstream code.
    this.agentRigs = next;
  }

  private updateRigStatus(rig: AvatarRig, status: PresenceStatus) {
    const color = STATUS_COLORS[status] ?? STATUS_COLORS.online;
    (rig.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  setEditState(state: EditState) {
    this.editState = state;
    this.ghostGroup.visible = state.active;
    for (const mesh of this.furnitureMeshes.values()) mesh.visible = true;
    if (!state.active) {
      this.clearGhost();
      this.setSelected(null);
    } else if (state.movingId) {
      const moving = this.furnitureMeshes.get(state.movingId);
      if (moving) moving.visible = false;
      if (state.movingCatalogId) {
        this.buildGhost(state.movingCatalogId, state.rotation);
      } else {
        this.clearGhost();
      }
    } else if (state.catalogId) {
      this.buildGhost(state.catalogId, state.rotation);
    } else {
      this.clearGhost();
    }
    this.setSelected(state.active ? this.selectedId : null);
  }

  setSelected(id: string | null) {
    this.selectedId = id;
    this.refreshSelection();
  }

  setCinematic(cinematic: boolean) {
    this.cinematic = cinematic;
  }

  setJoystick(x: number, y: number) {
    this.joystick.set(clamp(x, -1, 1), clamp(y, -1, 1));
    if (Math.abs(x) > 0.05 || Math.abs(y) > 0.05) {
      this.path = [];
      this.lastInputAt = performance.now();
    }
  }

  teleportToRoom(roomId: string, immediate = false) {
    const room = this.allRooms.find((item) => item.id === roomId);
    if (!room || room.locked) {
      this.callbacks.onInvalidTarget();
      return;
    }
    // The room may live on another storey; swapping floors rebuilds the 3D
    // interior before the player is placed in it.
    if ((room.floorIndex ?? 0) !== this.activeFloor) {
      this.setActiveFloor(room.floorIndex ?? 0);
    }
    this.playerPosition.set(room.spawn.x, 0, room.spawn.z);
    this.playerYaw = room.id === "reception" ? Math.PI : Math.PI;
    this.path = [];
    this.playerVelocity.set(0, 0);
    this.currentRoom = room;
    this.lastRoomCheck = 0;
    if (immediate) {
      this.cameraTarget.set(room.spawn.x, 1.1, room.spawn.z);
      this.cameraPosition.set(room.spawn.x, 7, room.spawn.z + 9);
      this.playerRig?.group.position.set(room.spawn.x, 0, room.spawn.z);
    }
    this.callbacks.onRoomChange(room);
    this.pushPosition(true);
  }

  faceZoe() {
    this.playerYaw = Math.atan2(
      ZOE_POS.x - this.playerPosition.x,
      ZOE_POS.z - this.playerPosition.z
    );
    if (this.playerRig) this.playerRig.group.rotation.y = this.playerYaw;
  }

  movePlayerTo(x: number, z: number, yaw?: number) {
    this.playerPosition.set(x, 0, z);
    this.playerVelocity.set(0, 0);
    this.path = [];
    if (typeof yaw === "number") {
      this.playerYaw = yaw;
      if (this.playerRig) this.playerRig.group.rotation.y = yaw;
    }
    this.lastRoomCheck = 0;
    this.pushPosition(true);
  }

  showBubble(userId: string, text: string) {
    const rig =
      userId === "you"
        ? this.playerRig
        : (this.agents.find((agent) => agent.user.id === userId)?.rig ??
          // The live roster is keyed by user id in its own map, so a colleague
          // who arrived over realtime can speak too.
          this.agentRigs.get(userId));
    if (!rig) return;
    this.setBubble(rig, text, 7000);
  }

  focusCamera(x: number, z: number) {
    this.cameraTarget.set(x, 1.1, z);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    window.removeEventListener("keydown", this.boundKeyDown);
    window.removeEventListener("keyup", this.boundKeyUp);
    window.removeEventListener("pointermove", this.boundPointerMove);
    window.removeEventListener("pointerup", this.boundPointerUp);
    window.removeEventListener("resize", this.boundResize);
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.boundPointerDown
    );
    this.renderer.domElement.removeEventListener(
      "pointerleave",
      this.boundPointerLeave
    );
    this.renderer.domElement.removeEventListener("wheel", this.boundWheel);

    this.tower?.dispose();
    if (this.tower) this.scene.remove(this.tower.group);
    this.tower = null;

    disposeObject(this.scene);
    this.skyTexture?.dispose();
    this.skyTexture = null;
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  // ------------------------------------------------------------------- build

  private build() {
    this.addLights();
    this.buildFloorContent();
    this.addAgents();
    this.addZoe();
    this.addPlayer();
    this.refreshSelection();
  }

  /** Everything that belongs to a single storey. */
  private buildFloorContent() {
    // The demo is a hand-built floor plan. The live building is whatever the
    // organisation actually has, so it is generated from the room list.
    if (this.isLive) {
      this.buildLiveFloorContent();
      return;
    }
    this.addGround();
    this.addShell();
    this.addInteriorWalls();
    this.addFloors();
    this.addDoorFrames();
    this.addRoomLabels();
    this.addStaticFurniture();
  }

  /**
   * Only the floor the user stands on exists in 3D, so switching floors throws
   * the storey away and builds the next one from its own rooms.
   */
  private rebuildFloorContent() {
    for (const group of [
      this.buildingGroup,
      this.staticGroup,
      this.furnitureGroup,
    ]) {
      for (const child of [...group.children]) {
        group.remove(child);
        disposeObject(child);
      }
    }

    this.colliders = [];
    this.wallColliders = [];
    this.staticColliders = [];
    this.furnitureColliders = [];
    this.furnitureMeshes.clear();
    this.labelSprites = [];
    this.marker = null;
    this.selectionHelper = null;

    if (this.isLive) {
      this.syncZoe();
      // Zoe is the receptionist: she is only rendered on the general floor.
      if (this.zoeRig) {
        this.zoeRig.group.visible = this.activeFloor === 0;
      }
    }
    this.buildFloorContent();
    // The demo ring belongs to the ground floor and is created with Zoe; a
    // rebuild throws it away, so put it back on the floor that owns her.
    if (
      !this.isLive &&
      this.zoeRig &&
      this.activeFloor === 0 &&
      !this.buildingGroup.getObjectByName("zoe-range")
    ) {
      this.addZoeRange();
    }
    // Rebuilding the storey also threw away the furniture meshes; put the
    // layouts for this floor back before the next frame.
    this.renderFurniture();
    this.refreshSelection();
  }

  /**
   * The live building has real people in it, so the seeded teammates are
   * removed and the real ones arrive over the presence channel.
   */
  clearDemoAgents() {
    for (const agent of this.agents) {
      this.avatarGroup.remove(agent.rig.group);
      disposeObject(agent.rig.group);
    }
    this.agents = [];
  }

  private addLights() {
    // A lit office: daylight bouncing off cream plaster above, warm oak below.
    const hemi = new THREE.HemisphereLight(
      PALETTE.lightWarm,
      PALETTE.wood,
      2.3
    );
    this.scene.add(hemi);

    // Every storey has its own footprint, so aim the sun at whatever floor is
    // being built instead of the demo's fixed corner.
    const center = this.isLive ? this.planCenter : { x: 28, z: 18 };
    const reach = this.isLive
      ? Math.max(this.planWidth, this.planDepth) / 2 + 12
      : 44;

    const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    // The tower presents its south facade to the camera, so the key light has
    // to come from +Z as well or every office cell is back-lit.
    sun.position.set(center.x + 22, 46, center.z + 34);
    sun.target.position.set(center.x, 0, center.z);
    this.scene.add(sun.target);
    sun.castShadow = !this.isMobile;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -reach;
    sun.shadow.camera.right = reach;
    sun.shadow.camera.top = reach;
    sun.shadow.camera.bottom = -reach;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 160;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    // The opposite side of the room has to be readable from the camera, so
    // the fill is neutral daylight rather than the brand purple.
    const fill = new THREE.DirectionalLight(PALETTE.screen, 0.45);
    fill.position.set(center.x - 24, 18, center.z + 22);
    fill.target.position.set(center.x, 0, center.z);
    this.scene.add(fill.target);
    this.scene.add(fill);

    if (this.isLive) return;

    // Downlights over the parts of the demo plan people actually stand in.
    const points: Array<[number, number, number, number, number, number]> = [
      [8.5, 2.6, 5, PALETTE.lightWarm, 20, 22],
      [9, 2.6, 19, PALETTE.glow, 16, 20],
      [23.5, 2.6, 6.5, PALETTE.lightWarm, 14, 18],
      [6.5, 2.6, 30.5, PALETTE.lightWarm, 12, 16],
      [17.5, 2.6, 30.5, PALETTE.lightWarm, 12, 16],
      [28.5, 2.6, 30.5, PALETTE.lightWarm, 12, 16],
      [49, 2.6, 20, PALETTE.glow, 14, 18],
      [50, 2.6, 31, PALETTE.glow, 14, 18],
    ];
    for (const [x, y, z, color, intensity, distance] of points) {
      const light = new THREE.PointLight(color, intensity, distance, 2);
      light.position.set(x, y, z);
      this.scene.add(light);
    }
  }

  private addGround() {
    const grid = new THREE.GridHelper(
      160,
      160,
      PALETTE.slabTint,
      PALETTE.stone
    );
    grid.position.set(28, -0.12, 18);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.3;
    this.staticGroup.add(grid);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(170, 140),
      new THREE.MeshStandardMaterial({
        color: PALETTE.site,
        roughness: 1,
        metalness: 0,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(28, -0.16, 18);
    ground.receiveShadow = true;
    this.staticGroup.add(ground);

    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(64, 0.22, 44),
      new THREE.MeshStandardMaterial({ color: PALETTE.stone, roughness: 0.85 })
    );
    plinth.position.set(28, -0.11, 18);
    plinth.receiveShadow = true;
    this.staticGroup.add(plinth);

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(38, 39, 96),
      new THREE.MeshBasicMaterial({
        color: PALETTE.accent,
        transparent: true,
        opacity: 0.14,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(28, -0.09, 18);
    this.staticGroup.add(glow);
  }

  private addShell() {
    const outer = new THREE.MeshStandardMaterial({
      color: PALETTE.wallShade,
      roughness: 0.85,
      metalness: 0.02,
    });
    const trim = new THREE.MeshStandardMaterial({
      color: PALETTE.frame,
      roughness: 0.6,
      metalness: 0.2,
    });

    // Main rectangle, with an opening into the private wing at z=24..26.
    this.addWallBox(22, 0.2, 44, 0.4, outer);
    this.addWallBox(22, 35.8, 44, 0.4, outer);
    this.addWallBox(0.2, 18, 0.4, 36, outer);
    this.addWallBox(43.8, 12.1, 0.4, 24.2, outer);
    this.addWallBox(43.8, 30.9, 0.4, 10.2, outer);

    // Private wing.
    this.addWallBox(50, 8.2, 12, 0.4, outer);
    this.addWallBox(55.8, 22, 0.4, 28, outer);
    this.addWallBox(50, 35.8, 12, 0.4, outer);

    // A cove of light where the wall meets the ceiling.
    const strip = new THREE.MeshStandardMaterial({
      color: PALETTE.glow,
      emissive: PALETTE.glow,
      emissiveIntensity: 1.6,
      roughness: 0.4,
    });
    this.addWallBox(22, 0.35, 43.4, 0.06, strip, 0.06, false, 2.55);
    this.addWallBox(22, 35.62, 43.4, 0.06, strip, 0.06, false, 2.55);
    this.addWallBox(0.36, 18, 0.06, 35.4, strip, 0.06, false, 2.55);
    this.addWallBox(43.62, 11, 0.06, 21.5, strip, 0.06, false, 2.55);
    this.addWallBox(55.64, 22, 0.06, 27.5, strip, 0.06, false, 2.55);

    // Mullions on the long glass facade.
    for (let x = 4; x < 44; x += 4) {
      const mullion = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 2.8, 0.13),
        trim
      );
      mullion.position.set(x, 1.4, 0.3);
      this.buildingGroup.add(mullion);
      mullion.castShadow = true;
    }

    // Entrance marker at the private wing opening.
    const sign = this.makeLabelSprite("PRIVATE WING", "#a78bfa", 0.9);
    sign.position.set(44, 2.5, 25);
    sign.scale.set(2.8, 0.7, 1);
    this.buildingGroup.add(sign);
  }

  private addInteriorWalls() {
    const wall = new THREE.MeshStandardMaterial({
      color: PALETTE.wall,
      roughness: 0.94,
      metalness: 0,
    });
    const wallDark = new THREE.MeshStandardMaterial({
      color: PALETTE.wallShade,
      roughness: 0.9,
      metalness: 0,
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: PALETTE.screen,
      transparent: true,
      opacity: 0.22,
      roughness: 0.08,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });

    // Top-room dividers and south wall with doors.
    this.addWallBox(17.5, 6.5, 0.28, 13, wall);
    this.addWallBox(30.5, 6.5, 0.28, 13, wall);
    this.addWallBox(4, 13, 8, 0.28, wall);
    this.addWallBox(16.25, 13, 12.5, 0.28, wall);
    this.addWallBox(30, 13, 11, 0.28, wall);
    this.addWallBox(40.75, 13, 6.5, 0.28, wall);

    // Lounge shell.
    this.addWallBox(4, 14, 8, 0.28, wall);
    this.addWallBox(14.25, 14, 8.5, 0.28, wall);
    this.addWallBox(4, 24, 8, 0.28, wall);
    this.addWallBox(14.25, 24, 8.5, 0.28, wall);
    this.addWallBox(18.5, 16.3, 0.28, 4.6, wall);
    this.addWallBox(18.5, 22.15, 0.28, 3.7, wall);

    // Focus pod partitions (low enough to see over).
    const pod = new THREE.MeshStandardMaterial({
      color: PALETTE.slabTint,
      roughness: 0.95,
    });
    for (const z of [14.2, 24.4]) {
      this.addWallBox(23.1, z, 7, 0.18, pod, 1.15);
      this.addWallBox(31.7, z, 7, 0.18, pod, 1.15);
    }
    for (const x of [19.6, 26.6, 28.2, 35.2]) {
      this.addWallBox(x, 16.3, 0.18, 4.0, pod, 1.15);
      this.addWallBox(x, 22.35, 0.18, 4.0, pod, 1.15);
    }

    // Channel room dividers and north wall with unlocked doors.
    this.addWallBox(12, 30.8, 0.28, 9.6, wall);
    this.addWallBox(23, 30.8, 0.28, 9.6, wall);
    this.addWallBox(34, 30.8, 0.28, 9.6, wall);
    this.addWallBox(2.75, 26, 5.5, 0.28, wall);
    this.addWallBox(12, 26, 9, 0.28, wall);
    this.addWallBox(23, 26, 9, 0.28, wall);
    this.addWallBox(36.75, 26, 14.5, 0.28, wall);

    // Private wing corridor and office doors.
    this.addWallBox(49, 9.85, 0.28, 3.4, wall);
    this.addWallBox(49, 16.5, 0.28, 6.4, wall);
    this.addWallBox(49, 25, 0.28, 7.4, wall);
    this.addWallBox(49, 33.15, 0.28, 5.7, wall);
    this.addWallBox(52.5, 16.6, 6, 0.28, wallDark);
    this.addWallBox(52.5, 24.4, 6, 0.28, wallDark);

    // Glass fronts make the meeting rooms read as meeting rooms.
    this.addWallBox(20.6, 12.82, 3.8, 0.06, glass, 2.5, false);
    this.addWallBox(26.4, 12.82, 3.8, 0.06, glass, 2.5, false);
    this.addWallBox(33.6, 12.82, 3.8, 0.06, glass, 2.5, false);
    this.addWallBox(39.4, 12.82, 3.8, 0.06, glass, 2.5, false);

    this.rebuildColliders();
  }

  private addFloors() {
    const corridor = new THREE.MeshStandardMaterial({
      color: PALETTE.stone,
      roughness: 0.72,
      metalness: 0.04,
    });
    const corridorAreas: Array<[number, number, number, number]> = [
      [22, 13.55, 44, 1.1],
      [22, 25, 44, 2],
      [31.25, 19.35, 25.5, 1.9],
      [46.5, 22, 5.2, 27.6],
      [27, 19.25, 17, 10.5],
      [39.75, 19.25, 8.5, 10.5],
    ];
    for (const [x, z, w, d] of corridorAreas) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), corridor);
      mesh.position.set(x, 0.01, z);
      mesh.receiveShadow = true;
      this.buildingGroup.add(mesh);
    }

    for (const room of ROOMS) {
      const texture = floorTextureFor(room.kind, room.bounds.w, room.bounds.d);
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.85,
        metalness: 0.02,
        emissive: new THREE.Color(room.accent),
        emissiveIntensity: 0.02,
      });
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(room.bounds.w, 0.1, room.bounds.d),
        material
      );
      floor.position.set(
        room.bounds.x + room.bounds.w / 2,
        0.05,
        room.bounds.z + room.bounds.d / 2
      );
      floor.receiveShadow = true;
      this.buildingGroup.add(floor);

      // A thin accent inlay at the room edge.
      const edgeMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(room.accent),
        transparent: true,
        opacity: 0.5,
      });
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(room.bounds.w + 0.1, 0.02, room.bounds.d + 0.1),
        edgeMat
      );
      edge.position.set(
        room.bounds.x + room.bounds.w / 2,
        0.005,
        room.bounds.z + room.bounds.d / 2
      );
      this.buildingGroup.add(edge);
    }
  }

  private addDoorFrames() {
    const frame = new THREE.MeshStandardMaterial({
      color: PALETTE.woodDark,
      roughness: 0.55,
      metalness: 0.25,
    });
    const red = new THREE.MeshStandardMaterial({
      color: 0x7f1d3a,
      emissive: 0x7f1d3a,
      emissiveIntensity: 0.8,
      roughness: 0.5,
    });

    const doors: Array<[number, number, number, "h" | "v"]> = [
      [9, 13, 2, "h"],
      [23.5, 13, 2, "h"],
      [36.5, 13, 2, "h"],
      [9, 14, 2, "h"],
      [9, 24, 2, "h"],
      [6.5, 26, 2, "h"],
      [17.5, 26, 2, "h"],
      [28.5, 26, 2, "h"],
      [49, 12.5, 1.6, "v"],
      [49, 20.5, 1.6, "v"],
      [49, 29.5, 1.6, "v"],
      [44, 25, 2, "v"],
    ];

    for (const [x, z, width, orientation] of doors) {
      if (orientation === "h") {
        this.addWallBox(
          x - width / 2 - 0.08,
          z,
          0.18,
          0.42,
          frame,
          2.35,
          false
        );
        this.addWallBox(
          x + width / 2 + 0.08,
          z,
          0.18,
          0.42,
          frame,
          2.35,
          false
        );
        this.addWallBox(x, z, width + 0.34, 0.4, frame, 0.22, false, 2.24);
      } else {
        this.addWallBox(
          x,
          z - width / 2 - 0.08,
          0.42,
          0.18,
          frame,
          2.35,
          false
        );
        this.addWallBox(
          x,
          z + width / 2 + 0.08,
          0.42,
          0.18,
          frame,
          2.35,
          false
        );
        this.addWallBox(x, z, 0.4, width + 0.34, frame, 0.22, false, 2.24);
      }
    }

    // Marketing is visible but locked.
    this.addWallBox(38.5, 26, 2, 0.24, red, 2.2, true);
    const lock = this.makeLabelSprite("LOCKED", "#fb7185", 0.9);
    lock.position.set(38.5, 2.55, 26);
    lock.scale.set(1.9, 0.5, 1);
    this.buildingGroup.add(lock);
  }

  private addRoomLabels() {
    // Signs sit inside their rooms, not in the corridors. A sign in the
    // corridor ends up between the camera and the player at spawn and fills
    // the bottom of the screen.
    const labels: Array<[number, number, string, string]> = [
      [9, 6.5, "RECEPTION", "#a78bfa"],
      [23.5, 7, "MEETING A", "#22d3ee"],
      [36.5, 7, "MEETING B", "#38bdf8"],
      [9, 19, "LOUNGE", "#f59e0b"],
      [6.5, 31, "#GENERAL", "#60a5fa"],
      [17.5, 31, "#DESIGN", "#f472b6"],
      [28.5, 31, "#DEV", "#34d399"],
      [38.5, 31, "#MARKETING", "#fbbf24"],
      [52.4, 12.6, "ADA", "#f472b6"],
      [52.4, 20.6, "TUNDE", "#34d399"],
      [52.4, 29.6, "YOUR OFFICE", "#a78bfa"],
    ];
    for (const [x, z, text, color] of labels) {
      const sprite = this.makeLabelSprite(text, color, 0.86);
      sprite.position.set(x, 2.5, z);
      sprite.scale.set(text.length > 9 ? 3.4 : 2.6, 0.62, 1);
      this.buildingGroup.add(sprite);
      this.labelSprites.push(sprite);
    }

    const zedu = this.makeLabelSprite("ZEDU", "#a78bfa", 1.2);
    zedu.position.set(9, 2.45, 1.82);
    zedu.scale.set(2.2, 0.8, 1);
    this.buildingGroup.add(zedu);
    this.labelSprites.push(zedu);

    const office = this.makeLabelSprite("THE OFFICE", "#e5e7eb", 0.8);
    office.position.set(9, 2.0, 1.82);
    office.scale.set(2.6, 0.5, 1);
    this.buildingGroup.add(office);
    this.labelSprites.push(office);
  }

  private addStaticFurniture() {
    // Reception
    this.addReceptionDesk(8.5, 4.1);
    this.addCounter(14, 7.4);
    this.addSofa(3.1, 9.1, 90, PALETTE.sofa);
    this.addCoffeeTable(4.9, 9.1);
    this.addRug(9, 8.2, 5, 3.4, PALETTE.accent);
    this.addPlant(2.4, 2.4);
    this.addPlant(15.2, 2.4);
    this.addPlant(2.4, 11.6);
    this.addCabinet(15.2, 11.4, 270);

    // Meeting A
    this.addMeetingTable(23.5, 6.8);
    this.addWhiteboard(23.5, 2.2, 0);
    this.addPlant(19.1, 2.8);
    this.addPlant(27.9, 2.8);
    this.addRug(23.5, 6.8, 6, 4, PALETTE.slabTint);

    // Meeting B
    this.addMeetingTable(36.5, 6.8);
    this.addScreen(36.5, 2.2, 0);
    this.addPlant(32.1, 2.8);
    this.addPlant(40.9, 2.8);
    this.addRug(36.5, 6.8, 6, 4, PALETTE.sofa);

    // Lounge
    this.addRug(9, 19, 10, 5, PALETTE.pot);
    this.addSofa(4.2, 18.9, 90, PALETTE.sofa);
    this.addSofa(13.8, 18.9, 270, PALETTE.sofa);
    this.addCoffeeTable(9, 19);
    this.addBeanbag(6.6, 22.2, PALETTE.accent);
    this.addBeanbag(11.4, 22.2, PALETTE.glow);
    this.addPlant(2.5, 14.9);
    this.addPlant(16.9, 14.9);
    this.addPlant(16.9, 23.2);
    this.addShelf(2.4, 20.5, 90);
    this.addLamp(16.5, 20.2);

    // Focus pods
    for (const [x, z] of [
      [23.1, 16.2],
      [31.7, 16.2],
      [23.1, 22.4],
      [31.7, 22.4],
    ]) {
      this.addFocusDesk(x, z);
      this.addPlant(x + 2.7, z - 1.1);
    }

    // Channels
    this.addMeetingTable(6.5, 30.6);
    this.addWhiteboard(2.15, 30.6, 90);
    this.addPlant(2.6, 27.2);
    this.addPlant(10.6, 27.2);
    this.addRug(6.5, 30.6, 6.6, 4.2, PALETTE.slabTint);

    this.addMeetingTable(17.5, 30.6);
    this.addWhiteboard(22.15, 30.6, 270);
    this.addPlant(13.4, 27.2);
    this.addPlant(22.2, 27.2);
    this.addRug(17.5, 30.6, 6.6, 4.2, PALETTE.sofa);

    this.addMeetingTable(28.5, 30.6);
    this.addScreen(33.15, 30.6, 270);
    this.addPlant(24.4, 27.2);
    this.addPlant(33.2, 27.2);
    this.addRug(28.5, 30.6, 6.6, 4.2, PALETTE.accent);

    // Marketing stays empty behind the locked door.
    this.addPlant(35.2, 27.2);

    // Quiet nook
    this.addPlant(37.2, 15.2);
    this.addPlant(42.3, 15.2);
    this.addPlant(37.2, 23.4);
    this.addPlant(42.3, 23.4);
    this.addCabinet(40, 19.4, 0);
    this.addLamp(40, 15.4);

    // Private corridor
    this.addPlant(44.9, 9.4);
    this.addPlant(44.9, 34.6);
    this.addShelf(44.9, 18.2, 90);

    this.rebuildColliders();
  }

  // ------------------------------------------------------ live floor builder

  /**
   * The live floor is generated from the rooms the organisation actually has:
   * floor pads, low partitions with a doorway, a furniture kit per room kind
   * and a floor decal. Nothing here assumes the demo's two-wing plan.
   */
  private buildLiveFloorContent() {
    this.addLiveGround();
    this.addLiveRoomPads();
    this.addLiveWalls();
    this.addLiveFurniture();
    this.addLiveRoomLabels();
    if (this.activeFloor === 0) this.addZoeRange();
    this.rebuildColliders();
    this.refreshFloorLights();
  }

  /** Warm downlights follow the rooms on the storey that is being shown. */
  private refreshFloorLights() {
    for (const light of this.floorLights) {
      this.scene.remove(light);
      light.dispose();
    }
    this.floorLights = [];
    if (!this.isLive) return;

    // A renderer with thirty point lights drops to a slideshow, so the lights
    // are placed around where the person actually stands and the rest of the
    // floor is carried by the hemisphere and sun.
    const origin = this.playerPosition;
    this.lightsAnchor = { x: origin.x, z: origin.z };
    const nearest = [...this.rooms]
      .map((room) => {
        const cx = room.bounds.x + room.bounds.w / 2;
        const cz = room.bounds.z + room.bounds.d / 2;
        return { room, distance: Math.hypot(cx - origin.x, cz - origin.z) };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 9);

    for (const { room } of nearest) {
      const b = room.bounds;
      // A 5 by 5.4 office needs a third of the throw of a 16 by 6 lounge.
      const area = b.w * b.d;
      const light = new THREE.PointLight(
        PALETTE.lightWarm,
        clamp(3 + area * 0.12, 4, 9),
        clamp(Math.sqrt(area) * 2.1, 6, 16),
        2
      );
      light.position.set(b.x + b.w / 2, 2.35, b.z + b.d / 2);
      this.scene.add(light);
      this.floorLights.push(light);
    }
  }

  /**
   * The downlights are placed around where the person stands, so the set has
   * to move with them. Rebuilding costs a shader recompile, so a short walk
   * inside the same wing is left alone.
   */
  private updateFloorLights() {
    if (!this.isLive) return;
    const walked = Math.hypot(
      this.playerPosition.x - this.lightsAnchor.x,
      this.playerPosition.z - this.lightsAnchor.z
    );
    if (walked >= 7) this.refreshFloorLights();
  }

  private addLiveGround() {
    const { x: cx, z: cz } = this.planCenter;
    const span = Math.max(this.planWidth, this.planDepth);
    const grid = new THREE.GridHelper(
      Math.ceil(span) + 16,
      Math.ceil(span) + 16,
      PALETTE.slabTint,
      PALETTE.stone
    );
    grid.position.set(cx, -0.12, cz);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.28;
    this.staticGroup.add(grid);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.planWidth + 30, this.planDepth + 30),
      new THREE.MeshStandardMaterial({
        color: PALETTE.site,
        roughness: 1,
        metalness: 0,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.16, cz);
    ground.receiveShadow = true;
    this.staticGroup.add(ground);

    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(this.planWidth + 6, 0.22, this.planDepth + 6),
      new THREE.MeshStandardMaterial({ color: PALETTE.stone, roughness: 0.85 })
    );
    plinth.position.set(cx, -0.11, cz);
    plinth.receiveShadow = true;
    this.staticGroup.add(plinth);
  }

  private addLiveRoomPads() {
    for (const room of this.rooms) {
      const b = room.bounds;
      const cx = b.x + b.w / 2;
      const cz = b.z + b.d / 2;

      const texture = floorTextureFor(room.kind, b.w, b.d);
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(b.w, 0.1, b.d),
        new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.85,
          metalness: 0.02,
          emissive: new THREE.Color(room.accent),
          emissiveIntensity: 0.02,
        })
      );
      floor.position.set(cx, 0.05, cz);
      floor.receiveShadow = true;
      this.buildingGroup.add(floor);

      // A thin inlay keeps the room's own colour identity without lighting
      // the whole floor up in brand purple.
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(b.w + 0.08, 0.02, b.d + 0.08),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(room.accent),
          transparent: true,
          opacity: 0.32,
        })
      );
      edge.position.set(cx, 0.005, cz);
      this.buildingGroup.add(edge);
    }
  }

  private addLiveWalls() {
    const wall = new THREE.MeshStandardMaterial({
      color: PALETTE.wall,
      roughness: 0.94,
      metalness: 0,
    });
    const jamb = new THREE.MeshStandardMaterial({
      color: PALETTE.woodDark,
      roughness: 0.62,
      metalness: 0.06,
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: PALETTE.screen,
      transparent: true,
      opacity: 0.24,
      roughness: 0.08,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    const lamp = new THREE.MeshStandardMaterial({
      color: PALETTE.lightWarm,
      emissive: PALETTE.lightWarm,
      emissiveIntensity: 1.7,
      roughness: 0.5,
    });
    const thickness = 0.14;
    const doorHead = 2.1;

    for (const room of this.rooms) {
      const b = room.bounds;
      const cx = b.x + b.w / 2;
      const cz = b.z + b.d / 2;
      // A private office has a door you can shut; the open zones only get a
      // waist-high partition so the floor still reads as one plan.
      const closed = isClosedRoom(room.kind);
      const height = closed ? BUILDING.wallHeight : 1.15;
      // Every room opens onto the corridor on its south edge.
      const doorway = Math.min(1.7, Math.max(1, b.w * 0.42));
      const segment = (b.w - doorway) / 2;

      this.addWallBox(cx, b.z, b.w, thickness, wall, height);
      this.addWallBox(b.x, cz, thickness, b.d, wall, height);
      this.addWallBox(b.x + b.w, cz, thickness, b.d, wall, height);

      if (segment > 0.08) {
        // The wood around a doorway is what makes a room look entered, not
        // cut into. Open zones keep the plaster.
        const side = closed ? jamb : wall;
        this.addWallBox(
          b.x + segment / 2,
          b.z + b.d,
          segment,
          thickness,
          side,
          height
        );
        this.addWallBox(
          b.x + b.w - segment / 2,
          b.z + b.d,
          segment,
          thickness,
          side,
          height
        );
      }

      if (closed) {
        // The band over the door is glazed: a wing of forty closed offices is
        // still a bright building, and you can see who is at their desk.
        const head = Math.max(0.3, height - doorHead);
        this.addWallBox(
          cx,
          b.z + b.d,
          doorway,
          thickness,
          wall,
          head,
          false,
          doorHead + head / 2
        );
        const pane = new THREE.Mesh(
          new THREE.BoxGeometry(
            doorway * 0.88,
            Math.min(0.42, head * 0.6),
            0.05
          ),
          glass
        );
        pane.position.set(
          cx,
          doorHead + Math.min(0.42, head * 0.6) / 2 + 0.02,
          b.z + b.d + 0.09
        );
        this.buildingGroup.add(pane);
        // A dark threshold keeps the opening readable from the corridor.
        const mat = new THREE.Mesh(
          new THREE.BoxGeometry(doorway, 0.02, 0.5),
          new THREE.MeshStandardMaterial({
            color: PALETTE.slab,
            roughness: 1,
          })
        );
        mat.position.set(cx, 0.11, b.z + b.d);
        this.buildingGroup.add(mat);
      } else {
        const accent = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(0.5, b.w - 0.4), 0.045, 0.055),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(room.accent),
            emissive: new THREE.Color(room.accent),
            emissiveIntensity: 0.8,
            roughness: 0.4,
          })
        );
        accent.position.set(cx, height + 0.03, b.z + thickness / 2);
        this.buildingGroup.add(accent);
      }

      // The fitting every lit room is expected to have, just under the head.
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(
          Math.min(1.7, b.w * 0.5),
          0.05,
          Math.min(0.32, b.d * 0.16)
        ),
        lamp
      );
      strip.position.set(cx, height - 0.09, cz);
      this.buildingGroup.add(strip);
    }
  }

  private addLiveFurniture() {
    for (const room of this.rooms) {
      const b = room.bounds;
      const cx = b.x + b.w / 2;
      const cz = b.z + b.d / 2;

      switch (room.kind) {
        case "reception": {
          this.addRug(
            cx,
            cz + 0.4,
            Math.min(b.w - 1.2, 6),
            Math.min(b.d - 1.2, 4),
            PALETTE.accent
          );
          this.addReceptionDesk(cx, b.z + Math.min(3.2, b.d * 0.5));
          this.addPlant(b.x + 0.9, b.z + 0.9);
          this.addPlant(b.x + b.w - 0.9, b.z + 0.9);
          if (b.w >= 8)
            this.addSofa(b.x + b.w - 2.1, cz + 1.2, 270, PALETTE.sofa);
          break;
        }
        case "lobby": {
          this.addRug(
            cx,
            cz,
            Math.min(b.w - 1.2, 6),
            Math.min(b.d - 1.2, 3.6),
            PALETTE.slabTint
          );
          this.addCounter(cx, b.z + 1.5);
          this.addCoffeeTable(cx, cz + 0.8);
          this.addPlant(b.x + 0.9, b.z + 0.9);
          break;
        }
        case "lounge": {
          this.addRug(
            cx,
            cz,
            Math.min(b.w - 1.2, 9),
            Math.min(b.d - 1.2, 5),
            PALETTE.pot
          );
          if (b.w >= 6) {
            this.addSofa(b.x + 1.4, cz, 90, PALETTE.sofa);
            this.addSofa(b.x + b.w - 1.4, cz, 270, PALETTE.sofa);
          }
          this.addCoffeeTable(cx, cz);
          if (b.w >= 9) {
            this.addBeanbag(b.x + 2.6, b.z + b.d - 1.5, PALETTE.accent);
          }
          this.addPlant(b.x + 0.9, b.z + 0.9);
          break;
        }
        case "meeting": {
          this.addMeetingTable(cx, cz);
          if (b.d >= 5) this.addScreen(cx, b.z + 0.5, 0);
          if (b.w >= 6) this.addWhiteboard(b.x + 0.9, cz, 90);
          break;
        }
        case "focus": {
          // A quiet room is a desk on the window wall and a door that shuts.
          this.addWorkstation(cx, b.z + Math.min(1.3, b.d * 0.26));
          this.addPlant(b.x + b.w - 0.7, b.z + 0.7);
          break;
        }
        case "channel": {
          if (b.w >= 5.5 && b.d >= 4.5) {
            this.addRug(
              cx,
              cz,
              Math.min(b.w - 1.6, 7),
              Math.min(b.d - 1.6, 4.4),
              PALETTE.slabTint
            );
            this.addMeetingTable(cx, cz);
            if (b.w >= 9 && b.d >= 5.5) {
              this.addWorkstation(b.x + b.w - 1.7, b.z + 1.3);
            }
          } else {
            this.addWorkstation(cx, b.z + 1.3);
          }
          this.addPlant(b.x + 0.8, b.z + 0.8);
          break;
        }
        case "personal": {
          // Right of centre: the starter bookshelf stands to its left.
          this.addWallArt(
            cx + (b.w >= 4.2 ? 0.55 : 0),
            b.z,
            Math.min(1.2, b.w * 0.28)
          );
          break;
        }
        case "area": {
          this.addRug(
            cx,
            cz,
            Math.min(b.w - 1, 6),
            Math.min(b.d - 1, 4),
            PALETTE.sofa
          );
          if (b.w >= 6) this.addSofa(b.x + 1.2, cz, 90, PALETTE.slabTint);
          if (b.w >= 12) this.addCoffeeTable(cx, cz);
          if (b.w >= 12) this.addCounter(b.x + b.w - 2.4, b.z + b.d - 1.6);
          this.addPlant(b.x + b.w - 0.8, b.z + 0.8);
          break;
        }
      }
    }
  }

  /** A desk with its screen, keyboard and chair — what an office is judged by. */
  private addWorkstation(x: number, z: number) {
    const group = new THREE.Group();
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.07, 0.85),
      new THREE.MeshStandardMaterial({ color: PALETTE.wood, roughness: 0.55 })
    );
    top.position.y = 0.74;
    top.castShadow = true;
    top.receiveShadow = true;
    group.add(top);

    const steel = new THREE.MeshStandardMaterial({
      color: PALETTE.metal,
      metalness: 0.55,
      roughness: 0.4,
    });
    for (const sx of [-0.82, 0.82]) {
      for (const sz of [-0.3, 0.3]) {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, 0.72, 0.07),
          steel
        );
        leg.position.set(sx, 0.36, sz);
        group.add(leg);
      }
    }

    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.34, 0.04),
      new THREE.MeshStandardMaterial({ color: PALETTE.desk, roughness: 0.8 })
    );
    skirt.position.set(0, 0.5, -0.34);
    group.add(skirt);

    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 0.48, 0.04),
      new THREE.MeshStandardMaterial({ color: PALETTE.ink, roughness: 0.6 })
    );
    bezel.position.set(-0.18, 1.12, -0.24);
    group.add(bezel);

    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.4, 0.02),
      new THREE.MeshStandardMaterial({
        color: PALETTE.screen,
        emissive: PALETTE.screen,
        emissiveIntensity: 1.2,
        roughness: 0.3,
      })
    );
    panel.position.set(-0.18, 1.12, -0.21);
    group.add(panel);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.2), steel);
    foot.position.set(-0.18, 0.79, -0.2);
    group.add(foot);

    const keyboard = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.03, 0.18),
      new THREE.MeshStandardMaterial({
        color: PALETTE.wallShade,
        roughness: 0.9,
      })
    );
    keyboard.position.set(-0.18, 0.79, 0.14);
    group.add(keyboard);

    // A mug on the corner: the room is lived in, not staged.
    const mug = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.045, 0.1, 10),
      new THREE.MeshStandardMaterial({ color: PALETTE.pot, roughness: 0.7 })
    );
    mug.position.set(0.62, 0.83, -0.05);
    group.add(mug);

    group.position.set(x, 0, z);
    this.staticGroup.add(group);
    this.addCollider(x - 0.98, x + 0.98, z - 0.48, z + 0.48);
    this.addChair(x, z + 0.95, 180);
  }

  /** A framed print on the wall behind a desk. */
  private addWallArt(x: number, z: number, width: number) {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(width, width * 0.68, 0.05),
      new THREE.MeshStandardMaterial({
        color: PALETTE.woodDark,
        roughness: 0.6,
      })
    );
    frame.position.set(x, 1.66, z + 0.13);
    this.staticGroup.add(frame);

    const print = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.84, width * 0.54, 0.02),
      new THREE.MeshStandardMaterial({
        color: PALETTE.site,
        emissive: PALETTE.screen,
        emissiveIntensity: 0.14,
        roughness: 0.9,
      })
    );
    print.position.set(x, 1.66, z + 0.16);
    this.staticGroup.add(print);
  }

  /**
   * A closed room is named on the wall beside its door, the way a building
   * does it. An open zone has no wall to hang anything on, so its name stays
   * on its own floor — on a paper card, because white text on cream oak is
   * unreadable.
   */
  private addLiveRoomLabels() {
    for (const room of this.rooms) {
      const b = room.bounds;
      const cx = b.x + b.w / 2;
      const label =
        room.name.length > 20 ? `${room.name.slice(0, 19)}\u2026` : room.name;

      if (isClosedRoom(room.kind)) {
        const texture = makePlaqueTexture(label, room.accent, room.locked);
        const width = clamp(b.w * 0.76, 1.1, 2.2);
        const plaque = new THREE.Mesh(
          new THREE.PlaneGeometry(width, width * (72 / 256)),
          new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
          })
        );
        plaque.position.set(cx, BUILDING.wallHeight - 0.2, b.z + b.d + 0.11);
        this.buildingGroup.add(plaque);
        continue;
      }

      const texture = makeCanvasTexture(512, 160, (ctx) => {
        ctx.clearRect(0, 0, 512, 160);
        ctx.globalAlpha = 0.78;
        ctx.fillStyle = PAPER_CSS;
        roundRect(ctx, 36, 38, 440, 84, 20);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = INK_CSS;
        ctx.font = "800 46px Lato, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, 256, 80);
        ctx.fillStyle = room.accent;
        ctx.fillRect(196, 108, 120, 5);
      });
      const width = clamp(b.w * 0.82, 1.5, 4.8);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, width * (160 / 512)),
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(cx, 0.075, b.z + b.d * 0.62);
      this.buildingGroup.add(mesh);
    }
  }

  private addZoeRange() {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.8, 1.88, 64),
      new THREE.MeshBasicMaterial({
        color: 0xf4c46a,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(this.zoePosition.x, 0.02, this.zoePosition.z);
    ring.name = "zoe-range";
    this.buildingGroup.add(ring);
  }
  private addAgents() {
    // The real building renders the real roster over presence; seeded
    // teammates would stand in rooms their owners do not occupy.
    if (this.isLive) return;
    for (const user of DEMO_USERS) {
      if (user.id === "you" || user.isZoe) continue;
      const rig = this.createAvatar(
        user.avatar,
        user.name,
        user.id,
        user.status,
        false,
        false
      );
      rig.group.position.set(user.position.x, 0, user.position.z);
      rig.group.rotation.y = Math.random() * Math.PI * 2;
      this.avatarGroup.add(rig.group);
      this.agents.push({
        rig,
        user: { ...user, position: { ...user.position } },
        targetIndex: 1,
        pauseUntil: performance.now() + Math.random() * 2500,
        speed: user.speed ?? 0.4,
        lastRoomId: user.roomId,
      });
    }
  }

  private addZoe() {
    const zoe =
      DEMO_USERS.find((user) => user.isZoe) ??
      DEMO_USERS[DEMO_USERS.length - 1];
    this.zoeRig = this.createAvatar(
      zoe.avatar,
      "Zoe",
      "zoe",
      "online",
      true,
      false
    );
    this.zoeRig.group.position.set(this.zoePosition.x, 0, this.zoePosition.z);
    this.zoeRig.group.rotation.y = Math.PI;
    this.avatarGroup.add(this.zoeRig.group);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.035, 12, 48),
      new THREE.MeshStandardMaterial({
        color: 0xf4c46a,
        emissive: 0xf4c46a,
        emissiveIntensity: 2,
        roughness: 0.2,
      })
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 2.4;
    halo.name = "zoe-halo";
    this.zoeRig.group.add(halo);

    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.2),
      new THREE.MeshStandardMaterial({
        color: 0xfff0b8,
        emissive: 0xf4c46a,
        emissiveIntensity: 2.5,
        roughness: 0.15,
      })
    );
    diamond.position.y = 2.85;
    diamond.name = "zoe-diamond";
    this.zoeRig.group.add(diamond);

    this.addZoeRange();
  }

  private addPlayer() {
    this.playerRig = this.createAvatar(
      { tint: "#8b5cf6", body: "b", outfit: "smart", accessory: "glasses" },
      "You",
      "you",
      "online",
      false,
      true
    );
    this.playerRig.group.position.set(
      this.playerPosition.x,
      0,
      this.playerPosition.z
    );
    this.playerRig.group.rotation.y = this.playerYaw;
    this.avatarGroup.add(this.playerRig.group);
  }

  // -------------------------------------------------------------- primitives

  private addWallBox(
    x: number,
    z: number,
    w: number,
    d: number,
    material: THREE.Material,
    height = BUILDING.wallHeight,
    collider = true,
    yOverride?: number
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), material);
    mesh.position.set(x, yOverride ?? height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.buildingGroup.add(mesh);
    if (collider) {
      this.wallColliders.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minZ: z - d / 2,
        maxZ: z + d / 2,
      });
    }
    return mesh;
  }

  private addCollider(minX: number, maxX: number, minZ: number, maxZ: number) {
    this.staticColliders.push({ minX, maxX, minZ, maxZ });
  }

  private rebuildColliders() {
    this.colliders = this.wallColliders.concat(
      this.staticColliders,
      this.furnitureColliders
    );
  }

  private isBlocked(x: number, z: number, radius = 0.34): boolean {
    // A locked office is a real door: the room is visible in the building, but
    // walking through its doorway is refused. This is the client-side mirror
    // of the server's access rule, so the user never steps into a room the
    // enter endpoint will reject.
    for (const room of this.allRooms) {
      if (!room.locked || (room.floorIndex ?? 0) !== this.activeFloor) continue;
      const bounds = room.bounds;
      if (
        x > bounds.x + radius &&
        x < bounds.x + bounds.w - radius &&
        z > bounds.z + radius &&
        z < bounds.z + bounds.d - radius
      ) {
        return true;
      }
    }

    const inside = this.walkBounds.some(
      (area) =>
        x >= area.minX + radius &&
        x <= area.maxX - radius &&
        z >= area.minZ + radius &&
        z <= area.maxZ - radius
    );
    if (!inside) return true;
    for (const collider of this.colliders) {
      if (
        x > collider.minX - radius &&
        x < collider.maxX + radius &&
        z > collider.minZ - radius &&
        z < collider.maxZ + radius
      ) {
        return true;
      }
    }
    return false;
  }

  private resolveMove(dx: number, dz: number) {
    const nextX = this.playerPosition.x + dx;
    if (!this.isBlocked(nextX, this.playerPosition.z)) {
      this.playerPosition.x = nextX;
    }
    const nextZ = this.playerPosition.z + dz;
    if (!this.isBlocked(this.playerPosition.x, nextZ)) {
      this.playerPosition.z = nextZ;
    }
  }

  // -------------------------------------------------------------- furniture

  private buildFurniture(item: FurnitureItem): THREE.Mesh | null {
    const catalog = CATALOG_BY_ID[item.catalogId];
    if (!catalog) return null;
    const group = this.buildFurnitureMesh(item.catalogId, catalog.color);
    // A rug is 2cm thick; in the live building it lies on the room's 0.1 floor
    // pad instead of being drawn underneath it.
    const onPad = this.isLive && item.catalogId === "rug" ? 0.1 : 0;
    group.position.set(item.x, onPad, item.z);
    group.rotation.y = (item.rotation * Math.PI) / 180;
    group.userData.furnitureId = item.id;
    if (SEAT_HEIGHT[item.catalogId]) {
      group.userData.seatHeight = SEAT_HEIGHT[item.catalogId];
    }
    return group;
  }

  private buildFurnitureMesh(catalogId: string, color: string): THREE.Mesh {
    const tint = new THREE.Color(color);
    const dark = new THREE.Color(color).multiplyScalar(0.45);
    const metal = new THREE.MeshStandardMaterial({
      color: 0x2b2f45,
      roughness: 0.4,
      metalness: 0.7,
    });
    const wood = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.7,
    });
    const fabric = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.95,
    });
    const white = new THREE.MeshStandardMaterial({
      color: 0xf0f2fa,
      roughness: 0.5,
    });

    const root = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    root.castShadow = true;
    root.receiveShadow = true;

    const add = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      rx = 0,
      ry = 0,
      rz = 0
    ) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    };

    switch (catalogId) {
      case "desk_oak": {
        add(new THREE.BoxGeometry(1.9, 0.09, 0.9), wood, 0, 0.76, 0);
        for (const x of [-0.82, 0.82]) {
          for (const z of [-0.36, 0.36]) {
            add(new THREE.BoxGeometry(0.07, 0.72, 0.07), metal, x, 0.36, z);
          }
        }
        add(
          new THREE.BoxGeometry(0.62, 0.36, 0.04),
          new THREE.MeshStandardMaterial({
            color: 0x1a1f2e,
            emissive: 0x2d2a55,
            emissiveIntensity: 0.4,
          }),
          0,
          1.05,
          -0.22,
          0.08
        );
        add(new THREE.BoxGeometry(0.3, 0.05, 0.2), metal, 0, 0.84, 0.25);
        add(new THREE.BoxGeometry(0.08, 0.16, 0.08), metal, 0, 0.92, 0.25);
        break;
      }
      case "chair_ergo": {
        add(new THREE.BoxGeometry(0.5, 0.08, 0.5), fabric, 0, 0.46, 0);
        add(new THREE.BoxGeometry(0.5, 0.62, 0.09), fabric, 0, 0.79, -0.22);
        add(new THREE.CylinderGeometry(0.04, 0.04, 0.42, 8), metal, 0, 0.24, 0);
        for (let i = 0; i < 5; i += 1) {
          const angle = (i / 5) * Math.PI * 2;
          add(
            new THREE.BoxGeometry(0.34, 0.045, 0.05),
            metal,
            Math.cos(angle) * 0.16,
            0.07,
            Math.sin(angle) * 0.16,
            0,
            angle,
            0
          );
        }
        break;
      }
      case "table_meeting": {
        add(new THREE.BoxGeometry(3, 0.1, 1.6), white, 0, 0.76, 0);
        for (const x of [-1.3, 1.3]) {
          for (const z of [-0.62, 0.62]) {
            add(new THREE.BoxGeometry(0.1, 0.72, 0.1), metal, x, 0.36, z);
          }
        }
        add(
          new THREE.BoxGeometry(2.7, 0.04, 1.3),
          new THREE.MeshStandardMaterial({ color: dark, roughness: 0.8 }),
          0,
          0.83,
          0
        );
        break;
      }
      case "sofa": {
        add(new THREE.BoxGeometry(2.2, 0.32, 0.9), fabric, 0, 0.36, 0);
        add(new THREE.BoxGeometry(2.2, 0.55, 0.22), fabric, 0, 0.7, -0.36);
        for (const x of [-1.0, 1.0]) {
          add(new THREE.BoxGeometry(0.18, 0.55, 0.9), fabric, x, 0.5, 0);
        }
        for (const x of [-0.52, 0.52]) {
          add(
            new THREE.BoxGeometry(0.92, 0.12, 0.7),
            new THREE.MeshStandardMaterial({
              color: tint.clone().offsetHSL(0, 0, 0.08),
              roughness: 1,
            }),
            x,
            0.58,
            0.05
          );
        }
        for (const [x, z] of [
          [-0.9, -0.32],
          [0.9, -0.32],
          [-0.9, 0.32],
          [0.9, 0.32],
        ]) {
          add(new THREE.BoxGeometry(0.08, 0.2, 0.08), metal, x, 0.1, z);
        }
        break;
      }
      case "coffee_table": {
        add(new THREE.BoxGeometry(1.8, 0.08, 0.9), wood, 0, 0.4, 0);
        for (const x of [-0.75, 0.75]) {
          for (const z of [-0.32, 0.32]) {
            add(new THREE.BoxGeometry(0.07, 0.38, 0.07), metal, x, 0.19, z);
          }
        }
        add(
          new THREE.CylinderGeometry(0.09, 0.07, 0.12, 16),
          white,
          0.45,
          0.49,
          0.1
        );
        add(
          new THREE.BoxGeometry(0.4, 0.03, 0.28),
          new THREE.MeshStandardMaterial({ color: 0x7a4a2b }),
          -0.4,
          0.46,
          0.1
        );
        break;
      }
      case "plant": {
        add(
          new THREE.CylinderGeometry(0.2, 0.15, 0.38, 16),
          new THREE.MeshStandardMaterial({ color: 0x5a3d2b, roughness: 0.9 }),
          0,
          0.19,
          0
        );
        const leafMat = new THREE.MeshStandardMaterial({
          color: tint,
          roughness: 0.85,
        });
        for (let i = 0; i < 7; i += 1) {
          const angle = (i / 7) * Math.PI * 2;
          const radius = 0.12 + (i % 2) * 0.1;
          add(
            new THREE.SphereGeometry(0.18, 10, 8),
            leafMat,
            Math.cos(angle) * radius,
            0.55 + (i % 3) * 0.09,
            Math.sin(angle) * radius
          );
        }
        add(
          new THREE.CylinderGeometry(0.025, 0.035, 0.45, 8),
          new THREE.MeshStandardMaterial({ color: PALETTE.slabTint }),
          0,
          0.48,
          0
        );
        break;
      }
      case "whiteboard": {
        add(new THREE.BoxGeometry(2, 1.2, 0.08), white, 0, 1.45, 0);
        add(new THREE.BoxGeometry(2.1, 0.06, 0.12), metal, 0, 0.82, 0);
        add(new THREE.BoxGeometry(0.08, 0.82, 0.08), metal, -0.9, 0.41, 0);
        add(new THREE.BoxGeometry(0.08, 0.82, 0.08), metal, 0.9, 0.41, 0);
        add(
          new THREE.BoxGeometry(0.5, 0.03, 0.03),
          new THREE.MeshStandardMaterial({ color: 0x7141f8 }),
          -0.35,
          1.62,
          0.05
        );
        add(
          new THREE.BoxGeometry(0.6, 0.03, 0.03),
          new THREE.MeshStandardMaterial({ color: 0x22d3ee }),
          0.25,
          1.48,
          0.05
        );
        break;
      }
      case "screen": {
        add(
          new THREE.BoxGeometry(1.8, 1.05, 0.09),
          new THREE.MeshStandardMaterial({
            color: 0x0f1320,
            emissive: 0x2b2a66,
            emissiveIntensity: 0.7,
          }),
          0,
          1.45,
          0
        );
        add(new THREE.BoxGeometry(1.9, 0.05, 0.12), metal, 0, 0.9, 0);
        add(new THREE.BoxGeometry(0.08, 0.9, 0.08), metal, 0, 0.45, 0);
        add(
          new THREE.BoxGeometry(0.8, 0.45, 0.03),
          new THREE.MeshStandardMaterial({
            color: 0x60a5fa,
            emissive: 0x60a5fa,
            emissiveIntensity: 1.1,
          }),
          0,
          1.45,
          0.06
        );
        break;
      }
      case "rug": {
        add(new THREE.BoxGeometry(3, 0.02, 2), fabric, 0, 0.025, 0);
        add(
          new THREE.BoxGeometry(2.7, 0.021, 1.7),
          new THREE.MeshStandardMaterial({
            color: tint.clone().offsetHSL(0, 0, 0.12),
            roughness: 1,
          }),
          0,
          0.03,
          0
        );
        break;
      }
      case "lamp": {
        add(
          new THREE.CylinderGeometry(0.14, 0.18, 0.06, 16),
          metal,
          0,
          0.03,
          0
        );
        add(
          new THREE.CylinderGeometry(0.035, 0.035, 1.6, 10),
          metal,
          0,
          0.82,
          0
        );
        add(
          new THREE.ConeGeometry(0.3, 0.32, 20, 1, true),
          new THREE.MeshStandardMaterial({
            color: 0xf4c46a,
            emissive: 0xf4c46a,
            emissiveIntensity: 0.8,
            side: THREE.DoubleSide,
          }),
          0.22,
          1.55,
          0,
          0,
          0,
          -0.25
        );
        break;
      }
      case "shelf": {
        // Open at the front, so the books on every shelf can be seen.
        add(new THREE.BoxGeometry(0.9, 1.8, 0.04), wood, 0, 0.9, -0.155);
        for (const x of [-0.425, 0.425]) {
          add(new THREE.BoxGeometry(0.05, 1.8, 0.35), wood, x, 0.9, 0);
        }
        for (const y of [0.03, 0.47, 0.91, 1.35, 1.78]) {
          add(new THREE.BoxGeometry(0.8, 0.04, 0.33), wood, 0, y, 0);
        }
        const bookColors = [
          PALETTE.accent,
          PALETTE.screen,
          PALETTE.pot,
          PALETTE.glow,
          PALETTE.sofa,
          PALETTE.wallShade,
        ];
        for (let shelf = 0; shelf < 4; shelf += 1) {
          for (let i = 0, x = -0.36; x < 0.3; i += 1) {
            const w = 0.06 + ((shelf * 3 + i) % 3) * 0.02;
            const h = 0.26 + ((shelf + i) % 3) * 0.04;
            add(
              new THREE.BoxGeometry(w, h, 0.22),
              new THREE.MeshStandardMaterial({
                color: bookColors[(shelf * 2 + i) % bookColors.length],
                roughness: 0.9,
              }),
              x + w / 2,
              0.05 + shelf * 0.44 + h / 2,
              0.02
            );
            x += w + 0.015;
          }
        }
        break;
      }
      case "beanbag": {
        add(new THREE.SphereGeometry(0.42, 16, 12), fabric, 0, 0.3, 0);
        add(
          new THREE.SphereGeometry(0.28, 16, 12),
          new THREE.MeshStandardMaterial({
            color: tint.clone().offsetHSL(0, 0, 0.1),
            roughness: 1,
          }),
          0,
          0.14,
          0.14
        );
        break;
      }
      case "armchair": {
        const cushion = new THREE.MeshStandardMaterial({
          color: tint.clone().offsetHSL(0, 0, 0.1),
          roughness: 1,
        });
        add(new THREE.BoxGeometry(0.8, 0.3, 0.78), fabric, 0, 0.27, 0);
        add(new THREE.BoxGeometry(0.62, 0.1, 0.6), cushion, 0, 0.46, 0.05);
        add(new THREE.BoxGeometry(0.8, 0.62, 0.18), fabric, 0, 0.68, -0.3);
        for (const x of [-0.34, 0.34]) {
          add(new THREE.BoxGeometry(0.12, 0.26, 0.74), fabric, x, 0.55, 0);
        }
        break;
      }
      case "coffee_bar": {
        add(
          new THREE.BoxGeometry(1.7, 0.95, 0.62),
          new THREE.MeshStandardMaterial({ color: tint, roughness: 0.8 }),
          0,
          0.475,
          0
        );
        add(new THREE.BoxGeometry(1.8, 0.06, 0.7), white, 0, 0.98, 0);
        add(new THREE.BoxGeometry(0.42, 0.48, 0.36), metal, -0.45, 1.25, -0.05);
        add(
          new THREE.BoxGeometry(0.3, 0.04, 0.04),
          new THREE.MeshStandardMaterial({
            color: PALETTE.screen,
            emissive: PALETTE.screen,
            emissiveIntensity: 0.8,
          }),
          -0.45,
          1.38,
          0.14
        );
        for (const [i, x] of [0.2, 0.4, 0.6].entries()) {
          add(
            new THREE.CylinderGeometry(0.05, 0.045, 0.11, 10),
            new THREE.MeshStandardMaterial({
              color: [PALETTE.wall, PALETTE.pot, PALETTE.glow][i],
              roughness: 0.6,
            }),
            x,
            1.07,
            0.12
          );
        }
        break;
      }
      case "cabinet": {
        add(new THREE.BoxGeometry(0.6, 1.25, 0.6), wood, 0, 0.625, 0);
        for (const y of [0.3, 0.7, 1.08]) {
          add(
            new THREE.BoxGeometry(0.54, 0.34, 0.02),
            new THREE.MeshStandardMaterial({ color: dark, roughness: 0.6 }),
            0,
            y,
            0.305
          );
          add(new THREE.BoxGeometry(0.2, 0.03, 0.04), white, 0, y + 0.09, 0.33);
        }
        break;
      }
      case "art_easel": {
        const frame = new THREE.MeshStandardMaterial({
          color: PALETTE.woodDark,
          roughness: 0.6,
        });
        for (const x of [-0.3, 0.3]) {
          add(new THREE.BoxGeometry(0.05, 1.5, 0.05), metal, x, 0.75, 0, -0.12);
        }
        add(
          new THREE.BoxGeometry(0.05, 1.45, 0.05),
          metal,
          0,
          0.72,
          -0.32,
          0.4
        );
        add(new THREE.BoxGeometry(0.8, 0.06, 0.12), metal, 0, 0.55, 0.06);
        add(
          new THREE.BoxGeometry(0.86, 0.66, 0.04),
          frame,
          0,
          0.95,
          0.03,
          -0.12
        );
        add(
          new THREE.BoxGeometry(0.74, 0.54, 0.02),
          wood,
          0,
          0.95,
          0.055,
          -0.12
        );
        add(
          new THREE.CircleGeometry(0.1, 20),
          new THREE.MeshStandardMaterial({
            color: PALETTE.pot,
            roughness: 0.8,
          }),
          0.15,
          1.03,
          0.07,
          -0.12
        );
        add(
          new THREE.BoxGeometry(0.74, 0.14, 0.02),
          new THREE.MeshStandardMaterial({
            color: PALETTE.leaf,
            roughness: 0.8,
          }),
          0,
          0.75,
          0.09,
          -0.12
        );
        break;
      }
      default:
        add(new THREE.BoxGeometry(1, 1, 1), fabric, 0, 0.5, 0);
    }

    return root;
  }

  private clearFurniture() {
    this.furnitureGroup.children.slice().forEach((child) => {
      this.furnitureGroup.remove(child);
      disposeObject(child);
    });
    this.furnitureMeshes.clear();
    this.selectionHelper?.parent?.remove(this.selectionHelper);
    this.selectionHelper = null;
  }

  private refreshSelection() {
    if (this.selectionHelper) {
      this.selectionHelper.parent?.remove(this.selectionHelper);
      this.selectionHelper.geometry.dispose();
      if (Array.isArray(this.selectionHelper.material)) {
        this.selectionHelper.material.forEach((material) => material.dispose());
      } else {
        this.selectionHelper.material.dispose();
      }
      this.selectionHelper = null;
    }
    if (!this.selectedId) return;
    const mesh = this.furnitureMeshes.get(this.selectedId);
    if (!mesh) return;
    this.selectionHelper = new THREE.BoxHelper(mesh, 0xa78bfa);
    this.selectionHelper.position.y = 0.02;
    this.scene.add(this.selectionHelper);
  }

  private buildGhost(catalogId: string, rotation: number) {
    this.clearGhost();
    const catalog = CATALOG_BY_ID[catalogId];
    if (!catalog) return;
    const mesh = this.buildFurnitureMesh(catalogId, "#34d399");
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const material = (child.material as THREE.MeshStandardMaterial).clone();
        material.transparent = true;
        material.opacity = 0.52;
        material.depthWrite = false;
        material.color = new THREE.Color(0x34d399);
        material.emissive = new THREE.Color(0x34d399);
        material.emissiveIntensity = 0.6;
        child.material = material;
      }
    });
    mesh.rotation.y = (rotation * Math.PI) / 180;
    this.ghostMesh = mesh;
    // Start the ghost under the player so it is never stranded at the origin.
    const start = {
      x: Math.round(this.playerPosition.x * 2) / 2,
      z: Math.round(this.playerPosition.z * 2) / 2,
    };
    mesh.position.set(start.x, 0, start.z);
    this.ghostGroup.add(mesh);
    this.ghostPoint = start;
    const reason = this.placementReason(
      start.x,
      start.z,
      catalogId,
      catalog?.rotatable ? rotation : 0
    );
    this.ghostValid = reason === null;
    this.ghostReason = reason;
    this.updateGhost(this.ghostValid);
    this.publishGhostState();
  }

  private clearGhost() {
    if (this.ghostMesh) {
      this.ghostGroup.remove(this.ghostMesh);
      disposeObject(this.ghostMesh);
      this.ghostMesh = null;
    }
    this.ghostPoint = null;
    this.ghostReason = null;
  }

  private updateGhost(valid: boolean) {
    if (!this.ghostMesh) return;
    this.ghostMesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const material = child.material as THREE.MeshStandardMaterial;
        material.color.set(valid ? 0x34d399 : 0xf43f5e);
        material.emissive.set(valid ? 0x34d399 : 0xf43f5e);
      }
    });
  }

  // ---------------------------------------------------------------- avatars

  private createAvatar(
    config: AvatarConfig,
    name: string,
    id: string,
    status: PresenceStatus,
    isZoe: boolean,
    isPlayer: boolean
  ): AvatarRig {
    const group = new THREE.Group();
    group.name = `avatar-${id}`;

    const skin = new THREE.MeshStandardMaterial({
      color: isZoe ? 0xf4c46a : skinTone(id),
      roughness: 0.75,
    });
    const hair = new THREE.MeshStandardMaterial({
      color: isZoe ? 0x6b4a1e : hairColor(id),
      roughness: 0.9,
    });
    const tint = new THREE.MeshStandardMaterial({
      color: new THREE.Color(config.tint),
      roughness: 0.8,
    });
    const tintDark = new THREE.MeshStandardMaterial({
      color: new THREE.Color(config.tint).multiplyScalar(0.6),
      roughness: 0.85,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x1a1d2b,
      roughness: 0.85,
    });
    const shoe = new THREE.MeshStandardMaterial({
      color: isZoe ? 0x6b4a1e : 0x141722,
      roughness: 0.8,
    });

    const bodyScale =
      config.body === "a" ? 0.93 : config.body === "c" ? 1.08 : 1;
    const bodyWidth =
      config.body === "a" ? 0.26 : config.body === "c" ? 0.35 : 0.3;

    const torsoMat =
      config.outfit === "lab"
        ? new THREE.MeshStandardMaterial({ color: 0xe9ecf5, roughness: 0.85 })
        : config.outfit === "smart"
          ? tintDark
          : tint;

    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(bodyWidth, 0.5 * bodyScale, 8, 16),
      torsoMat
    );
    torso.position.y = 1.12;
    torso.castShadow = true;
    group.add(torso);

    if (config.outfit === "smart") {
      const shirt = new THREE.Mesh(
        new THREE.BoxGeometry(bodyWidth * 0.8, 0.5, 0.04),
        new THREE.MeshStandardMaterial({ color: 0xf1f3fb, roughness: 0.8 })
      );
      shirt.position.set(0, 1.2, bodyWidth * 0.82);
      group.add(shirt);
      const tie = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.34, 0.03),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(config.tint),
          roughness: 0.7,
        })
      );
      tie.position.set(0, 1.16, bodyWidth * 0.86);
      group.add(tie);
    }

    if (config.outfit === "hoodie") {
      const hood = new THREE.Mesh(
        new THREE.TorusGeometry(bodyWidth * 0.85, 0.07, 8, 20, Math.PI),
        tintDark
      );
      hood.rotation.x = Math.PI / 2;
      hood.position.set(0, 1.38, -0.04);
      group.add(hood);
    }

    if (config.outfit === "lab") {
      const coat = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.62, 0.05),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(config.tint),
          roughness: 0.7,
        })
      );
      coat.position.set(0.14, 1.17, bodyWidth * 0.84);
      group.add(coat);
    }

    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.11, 0.12, 12),
      skin
    );
    neck.position.y = 1.46;
    group.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.255, 20, 16), skin);
    head.position.y = 1.68;
    head.castShadow = true;
    group.add(head);

    const hairMesh = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.262,
        20,
        14,
        0,
        Math.PI * 2,
        0,
        Math.PI * 0.58
      ),
      hair
    );
    hairMesh.position.y = 1.72;
    hairMesh.rotation.y = Math.PI;
    group.add(hairMesh);

    // Eyes and mouth live on +z; the whole group rotates toward its heading.
    for (const x of [-0.085, 0.085]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x161923 })
      );
      eye.position.set(x, 1.7, 0.238);
      group.add(eye);
    }
    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.012, 0.01),
      new THREE.MeshBasicMaterial({ color: 0x87464a })
    );
    mouth.position.set(0, 1.6, 0.248);
    group.add(mouth);

    if (config.accessory === "glasses") {
      const glassMat = new THREE.MeshStandardMaterial({
        color: 0x11131c,
        metalness: 0.5,
        roughness: 0.4,
      });
      for (const x of [-0.088, 0.088]) {
        const lens = new THREE.Mesh(
          new THREE.TorusGeometry(0.075, 0.011, 6, 16),
          glassMat
        );
        lens.position.set(x, 1.7, 0.252);
        group.add(lens);
      }
      const bridge = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.012, 0.012),
        glassMat
      );
      bridge.position.set(0, 1.7, 0.252);
      group.add(bridge);
    }

    if (config.accessory === "headphones") {
      const hpMat = new THREE.MeshStandardMaterial({
        color: 0x1b1e2d,
        roughness: 0.5,
        metalness: 0.3,
      });
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.27, 0.028, 8, 24, Math.PI),
        hpMat
      );
      band.rotation.x = Math.PI / 2;
      band.position.y = 1.75;
      group.add(band);
      for (const x of [-0.27, 0.27]) {
        const cup = new THREE.Mesh(
          new THREE.CylinderGeometry(0.075, 0.075, 0.06, 16),
          hpMat
        );
        cup.rotation.z = Math.PI / 2;
        cup.position.set(x, 1.7, 0);
        group.add(cup);
      }
    }

    if (config.accessory === "cap") {
      const capMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(config.tint),
        roughness: 0.85,
      });
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.265, 0.265, 0.09, 20),
        capMat
      );
      cap.position.y = 1.89;
      group.add(cap);
      const brim = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.025, 0.16),
        capMat
      );
      brim.position.set(0, 1.85, 0.24);
      group.add(brim);
    }

    const leftArm = new THREE.Group();
    leftArm.position.set(-bodyWidth - 0.07, 1.38, 0);
    const leftArmMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.07, 0.4, 6, 10),
      config.outfit === "casual" ? skin : torsoMat
    );
    leftArmMesh.position.y = -0.22;
    leftArmMesh.castShadow = true;
    leftArm.add(leftArmMesh);
    const leftHand = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 10, 8),
      skin
    );
    leftHand.position.y = -0.47;
    leftArm.add(leftHand);
    group.add(leftArm);

    const rightArm = new THREE.Group();
    rightArm.position.set(bodyWidth + 0.07, 1.38, 0);
    const rightArmMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.07, 0.4, 6, 10),
      config.outfit === "casual" ? skin : torsoMat
    );
    rightArmMesh.position.y = -0.22;
    rightArmMesh.castShadow = true;
    rightArm.add(rightArmMesh);
    const rightHand = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 10, 8),
      skin
    );
    rightHand.position.y = -0.47;
    rightArm.add(rightHand);
    group.add(rightArm);

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.13, 0.82, 0);
    const leftLegMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.09, 0.52, 6, 10),
      dark
    );
    leftLegMesh.position.y = -0.3;
    leftLegMesh.castShadow = true;
    leftLeg.add(leftLegMesh);
    const leftShoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.08, 0.22),
      shoe
    );
    leftShoe.position.set(0, -0.62, 0.05);
    leftLeg.add(leftShoe);
    group.add(leftLeg);

    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.13, 0.82, 0);
    const rightLegMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.09, 0.52, 6, 10),
      dark
    );
    rightLegMesh.position.y = -0.3;
    rightLegMesh.castShadow = true;
    rightLeg.add(rightLegMesh);
    const rightShoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.08, 0.22),
      shoe
    );
    rightShoe.position.set(0, -0.62, 0.05);
    rightLeg.add(rightShoe);
    group.add(rightLeg);

    const ringColor = isZoe ? 0xf4c46a : STATUS_COLORS[status];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.36, 0.47, 40),
      new THREE.MeshBasicMaterial({
        color: ringColor,
        transparent: true,
        opacity: isPlayer ? 0.85 : 0.6,
        side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);

    const label = this.makeNameplate(
      name,
      status,
      config.tint,
      isPlayer,
      isZoe
    );
    label.position.y = isZoe ? 2.3 : 2.13;
    group.add(label);

    if (isPlayer) {
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.12, 0.22, 4),
        new THREE.MeshBasicMaterial({ color: 0xa78bfa })
      );
      arrow.rotation.x = Math.PI;
      arrow.position.y = 2.42;
      arrow.name = "player-arrow";
      group.add(arrow);
    }

    if (isZoe) {
      const aura = new THREE.PointLight(0xf4c46a, 2.3, 5, 2);
      aura.position.set(0, 1.5, 0);
      group.add(aura);
    }

    return {
      group,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      torso,
      ring,
      phase: Math.random() * Math.PI * 2,
    };
  }

  private animateRig(rig: AvatarRig, speed: number, elapsed: number) {
    const stride = Math.min(speed / 2.6, 1);
    const swing = Math.sin(elapsed * 9 + rig.phase) * 0.7 * stride;
    rig.leftArm.rotation.x = swing;
    rig.rightArm.rotation.x = -swing;
    rig.leftLeg.rotation.x = -swing * 0.8;
    rig.rightLeg.rotation.x = swing * 0.8;
    if (speed > 0.15) {
      rig.group.position.y =
        Math.abs(Math.sin(elapsed * 9 + rig.phase)) * 0.035 * stride;
    } else {
      rig.group.position.y = Math.sin(elapsed * 1.4 + rig.phase) * 0.008;
      rig.leftArm.rotation.x = Math.sin(elapsed * 1.2 + rig.phase) * 0.04;
      rig.rightArm.rotation.x = -Math.sin(elapsed * 1.2 + rig.phase) * 0.04;
    }
  }

  private setBubble(rig: AvatarRig, text: string, duration: number) {
    if (rig.bubble) {
      rig.group.remove(rig.bubble.sprite);
      rig.bubble.material.dispose();
      rig.bubble.texture.dispose();
    }
    const texture = makeCanvasTexture(640, 260, (ctx) => {
      ctx.clearRect(0, 0, 640, 260);
      const words = text.split(" ");
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (candidate.length > 34 && line) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);
      const visible = lines.slice(0, 4);
      const height = 60 + visible.length * 42;
      const bubbleTop = 224 - height;
      ctx.fillStyle = "rgba(9, 12, 22, 0.92)";
      ctx.strokeStyle = "rgba(167, 139, 250, 0.55)";
      ctx.lineWidth = 3;
      roundRect(ctx, 18, bubbleTop, 604, height, 22);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(9, 12, 22, 0.92)";
      ctx.beginPath();
      ctx.moveTo(300, 222);
      ctx.lineTo(340, 222);
      ctx.lineTo(320, 250);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#f4f5fb";
      ctx.font = "600 30px Lato, Arial, sans-serif";
      ctx.textAlign = "center";
      visible.forEach((entry, index) => {
        ctx.fillText(entry, 320, bubbleTop + 44 + index * 42);
      });
    });
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(0, 2.75, 0);
    sprite.scale.set(2.7, 1.1, 1);
    rig.group.add(sprite);
    rig.bubble = {
      sprite,
      material,
      texture,
      until: performance.now() + duration,
    };
  }

  private makeNameplate(
    name: string,
    status: PresenceStatus,
    tint: string,
    isPlayer: boolean,
    isZoe: boolean
  ): THREE.Sprite {
    const texture = makeCanvasTexture(512, 144, (ctx) => {
      ctx.clearRect(0, 0, 512, 144);
      ctx.fillStyle = "rgba(9, 12, 22, 0.82)";
      ctx.strokeStyle = isPlayer
        ? "rgba(167, 139, 250, 0.9)"
        : isZoe
          ? "rgba(244, 196, 106, 0.9)"
          : "rgba(255, 255, 255, 0.16)";
      ctx.lineWidth = 3;
      roundRect(ctx, 20, 28, 472, 76, 24);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.arc(64, 66, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f5f6fb";
      ctx.font = "700 34px Lato, Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(name.length > 16 ? `${name.slice(0, 15)}…` : name, 92, 77);
      ctx.fillStyle = "rgba(200, 207, 228, 0.78)";
      ctx.font = "500 20px Lato, Arial, sans-serif";
      ctx.textAlign = "right";
      const label = isZoe
        ? "ASSISTANT"
        : status === "dnd"
          ? "DND"
          : status === "call"
            ? "IN CALL"
            : status === "away"
              ? "AWAY"
              : "ONLINE";
      ctx.fillText(label, 474, 76);
    });
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.1, 0.59, 1);
    return sprite;
  }

  private makeLabelSprite(
    text: string,
    color: string,
    opacity = 1
  ): THREE.Sprite {
    const texture = makeCanvasTexture(512, 128, (ctx) => {
      ctx.clearRect(0, 0, 512, 128);
      ctx.globalAlpha = opacity;
      ctx.fillStyle = "rgba(8, 10, 19, 0.82)";
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      roundRect(ctx, 12, 28, 488, 72, 20);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "700 30px Lato, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 256, 65);
    });
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.6, 0.62, 1);
    return sprite;
  }

  // -------------------------------------------------------------- furniture helpers

  private addReceptionDesk(x: number, z: number) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(4, 1.05, 1.2),
      new THREE.MeshStandardMaterial({
        color: PALETTE.counter,
        roughness: 0.6,
        metalness: 0.05,
      })
    );
    body.position.y = 0.55;
    body.castShadow = true;
    group.add(body);
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 0.08, 1.35),
      new THREE.MeshStandardMaterial({
        color: PALETTE.stone,
        roughness: 0.35,
        metalness: 0.1,
      })
    );
    top.position.y = 1.11;
    group.add(top);
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 0.04, 0.04),
      new THREE.MeshStandardMaterial({
        color: PALETTE.glow,
        emissive: PALETTE.glow,
        emissiveIntensity: 1.6,
      })
    );
    glow.position.set(0, 0.72, 0.62);
    group.add(glow);
    const badge = this.makeLabelSprite("ZOE", "#f4c46a", 0.95);
    badge.position.set(0, 1.55, 0.3);
    badge.scale.set(1.2, 0.36, 1);
    group.add(badge);
    group.position.set(x, 0, z);
    this.staticGroup.add(group);
    this.addCollider(x - 2.1, x + 2.1, z - 0.7, z + 0.7);
  }

  private addCounter(x: number, z: number) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.0, 0.8),
      new THREE.MeshStandardMaterial({ color: PALETTE.counter, roughness: 0.6 })
    );
    body.position.y = 0.5;
    body.castShadow = true;
    group.add(body);
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(2.55, 0.08, 0.95),
      new THREE.MeshStandardMaterial({
        color: PALETTE.stone,
        roughness: 0.35,
        metalness: 0.12,
      })
    );
    top.position.y = 1.04;
    group.add(top);
    group.position.set(x, 0, z);
    this.staticGroup.add(group);
    this.addCollider(x - 1.3, x + 1.3, z - 0.5, z + 0.5);
  }

  private addMeetingTable(x: number, z: number) {
    const group = new THREE.Group();
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 0.1, 1.4),
      new THREE.MeshStandardMaterial({ color: PALETTE.wood, roughness: 0.5 })
    );
    top.position.y = 0.76;
    top.castShadow = true;
    group.add(top);
    for (const sx of [-1.15, 1.15]) {
      for (const sz of [-0.5, 0.5]) {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.72, 0.08),
          new THREE.MeshStandardMaterial({
            color: PALETTE.metal,
            metalness: 0.6,
            roughness: 0.4,
          })
        );
        leg.position.set(sx, 0.36, sz);
        group.add(leg);
      }
    }
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.02, 0.03),
      new THREE.MeshStandardMaterial({
        color: PALETTE.accent,
        emissive: PALETTE.accent,
        emissiveIntensity: 1.1,
      })
    );
    glow.position.set(0, 0.82, 0);
    group.add(glow);
    group.position.set(x, 0, z);
    this.staticGroup.add(group);
    this.addCollider(x - 1.45, x + 1.45, z - 0.75, z + 0.75);

    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const cx = x + Math.cos(angle) * 2.1;
      const cz = z + Math.sin(angle) * 1.35;
      this.addChair(cx, cz, (angle * 180) / Math.PI + 90);
    }
  }

  private addChair(x: number, z: number, rotation: number) {
    const group = new THREE.Group();
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.07, 0.46),
      new THREE.MeshStandardMaterial({ color: PALETTE.slab, roughness: 0.9 })
    );
    seat.position.y = 0.45;
    group.add(seat);
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.5, 0.07),
      new THREE.MeshStandardMaterial({ color: PALETTE.slab, roughness: 0.9 })
    );
    back.position.set(0, 0.72, -0.2);
    group.add(back);
    for (const sx of [-0.18, 0.18]) {
      for (const sz of [-0.18, 0.18]) {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.44, 0.04),
          new THREE.MeshStandardMaterial({
            color: PALETTE.metal,
            metalness: 0.5,
          })
        );
        leg.position.set(sx, 0.22, sz);
        group.add(leg);
      }
    }
    group.position.set(x, 0, z);
    group.rotation.y = (rotation * Math.PI) / 180;
    group.userData.seatHeight = 0.47;
    this.staticGroup.add(group);
  }

  private addSofa(x: number, z: number, rotation: number, color: number) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.32, 0.9), mat);
    base.position.y = 0.32;
    base.castShadow = true;
    group.add(base);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 0.22), mat);
    back.position.set(0, 0.65, -0.36);
    group.add(back);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.9), mat);
      arm.position.set(sx, 0.5, 0);
      group.add(arm);
    }
    for (const sx of [-0.52, 0.52]) {
      const cushion = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.12, 0.66),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(color).offsetHSL(0, 0, 0.08),
          roughness: 1,
        })
      );
      cushion.position.set(sx, 0.52, 0.06);
      group.add(cushion);
    }
    group.position.set(x, 0, z);
    group.rotation.y = (rotation * Math.PI) / 180;
    group.userData.seatHeight = 0.56;
    this.staticGroup.add(group);
    const rotated = rotation % 180 !== 0;
    const hw = rotated ? 0.6 : 1.15;
    const hd = rotated ? 1.15 : 0.6;
    this.addCollider(x - hw, x + hw, z - hd, z + hd);
  }

  private addCoffeeTable(x: number, z: number) {
    const group = new THREE.Group();
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.08, 0.8),
      new THREE.MeshStandardMaterial({ color: PALETTE.desk, roughness: 0.7 })
    );
    top.position.y = 0.4;
    top.castShadow = true;
    group.add(top);
    for (const sx of [-0.65, 0.65]) {
      for (const sz of [-0.28, 0.28]) {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.38, 0.06),
          new THREE.MeshStandardMaterial({
            color: PALETTE.metal,
            metalness: 0.6,
          })
        );
        leg.position.set(sx, 0.19, sz);
        group.add(leg);
      }
    }
    group.position.set(x, 0, z);
    this.staticGroup.add(group);
    this.addCollider(x - 0.85, x + 0.85, z - 0.45, z + 0.45);
  }

  private addRug(x: number, z: number, w: number, d: number, color: number) {
    const rug = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.02, d),
      new THREE.MeshStandardMaterial({ color, roughness: 1 })
    );
    rug.position.set(x, 0.03, z);
    rug.receiveShadow = true;
    this.staticGroup.add(rug);
    const inner = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.86, 0.021, d * 0.82),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).offsetHSL(0, 0, 0.08),
        roughness: 1,
      })
    );
    inner.position.set(x, 0.04, z);
    this.staticGroup.add(inner);
  }

  private addPlant(x: number, z: number) {
    const group = new THREE.Group();
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.15, 0.38, 14),
      new THREE.MeshStandardMaterial({ color: PALETTE.pot, roughness: 0.9 })
    );
    pot.position.y = 0.19;
    group.add(pot);
    const leafMat = new THREE.MeshStandardMaterial({
      color: PALETTE.leaf,
      roughness: 0.85,
    });
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const leaf = new THREE.Mesh(
        new THREE.SphereGeometry(0.19, 10, 8),
        leafMat
      );
      leaf.position.set(
        Math.cos(angle) * 0.12,
        0.55 + (i % 3) * 0.1,
        Math.sin(angle) * 0.12
      );
      leaf.scale.set(0.9, 1.25, 0.9);
      group.add(leaf);
    }
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.035, 0.5, 8),
      new THREE.MeshStandardMaterial({ color: PALETTE.woodDark })
    );
    stem.position.y = 0.48;
    group.add(stem);
    group.position.set(x, 0, z);
    this.staticGroup.add(group);
    this.addCollider(x - 0.24, x + 0.24, z - 0.24, z + 0.24);
  }

  private addBeanbag(x: number, z: number, color: number) {
    const group = new THREE.Group();
    const bean = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 16, 12),
      new THREE.MeshStandardMaterial({ color, roughness: 1 })
    );
    bean.position.y = 0.3;
    bean.castShadow = true;
    group.add(bean);
    const top = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 16, 12),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).offsetHSL(0, 0, 0.1),
        roughness: 1,
      })
    );
    top.position.set(0, 0.14, 0.14);
    group.add(top);
    group.position.set(x, 0, z);
    group.userData.seatHeight = SEAT_HEIGHT.beanbag;
    this.staticGroup.add(group);
    this.addCollider(x - 0.4, x + 0.4, z - 0.4, z + 0.4);
  }

  private addShelf(x: number, z: number, rotation: number) {
    const group = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.8, 0.35),
      new THREE.MeshStandardMaterial({ color: PALETTE.desk, roughness: 0.8 })
    );
    frame.position.y = 0.9;
    frame.castShadow = true;
    group.add(frame);
    const colors = [0x7141f8, 0x22d3ee, 0xf472b6, 0xf59e0b, 0x34d399, 0xe5e7eb];
    for (let i = 0; i < 10; i += 1) {
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.24, 0.2),
        new THREE.MeshStandardMaterial({
          color: colors[i % colors.length],
          roughness: 0.9,
        })
      );
      book.position.set(
        -0.3 + (i % 4) * 0.16,
        0.58 + Math.floor(i / 4) * 0.38,
        0.03
      );
      group.add(book);
    }
    group.position.set(x, 0, z);
    group.rotation.y = (rotation * Math.PI) / 180;
    this.staticGroup.add(group);
    this.addCollider(x - 0.3, x + 0.3, z - 0.5, z + 0.5);
  }

  private addCabinet(x: number, z: number, rotation: number) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.0, 0.45),
      new THREE.MeshStandardMaterial({ color: PALETTE.desk, roughness: 0.6 })
    );
    body.position.y = 0.5;
    body.castShadow = true;
    group.add(body);
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.06, 0.52),
      new THREE.MeshStandardMaterial({
        color: PALETTE.wood,
        metalness: 0.3,
        roughness: 0.4,
      })
    );
    top.position.y = 1.03;
    group.add(top);
    group.position.set(x, 0, z);
    group.rotation.y = (rotation * Math.PI) / 180;
    this.staticGroup.add(group);
    this.addCollider(x - 0.45, x + 0.45, z - 0.85, z + 0.85);
  }

  private addLamp(x: number, z: number) {
    const group = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.2, 0.06, 16),
      new THREE.MeshStandardMaterial({ color: PALETTE.metal, metalness: 0.5 })
    );
    base.position.y = 0.03;
    group.add(base);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.6, 10),
      new THREE.MeshStandardMaterial({ color: PALETTE.metal, metalness: 0.5 })
    );
    pole.position.y = 0.82;
    group.add(pole);
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 0.32, 20, 1, true),
      new THREE.MeshStandardMaterial({
        color: PALETTE.glow,
        emissive: PALETTE.glow,
        emissiveIntensity: 1.2,
        side: THREE.DoubleSide,
      })
    );
    shade.position.set(0.18, 1.56, 0);
    shade.rotation.z = -0.25;
    group.add(shade);
    group.position.set(x, 0, z);
    this.staticGroup.add(group);
    this.addCollider(x - 0.2, x + 0.2, z - 0.2, z + 0.2);
  }

  private addWhiteboard(x: number, z: number, rotation: number) {
    const group = new THREE.Group();
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1.2, 0.08),
      new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.5 })
    );
    board.position.y = 1.45;
    group.add(board);
    const tray = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.05, 0.12),
      new THREE.MeshStandardMaterial({ color: PALETTE.metal, metalness: 0.5 })
    );
    tray.position.y = 0.82;
    group.add(tray);
    const line1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.03, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x7141f8 })
    );
    line1.position.set(-0.35, 1.6, 0.05);
    group.add(line1);
    const line2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.03, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x22d3ee })
    );
    line2.position.set(0.2, 1.45, 0.05);
    group.add(line2);
    group.position.set(x, 0, z);
    group.rotation.y = (rotation * Math.PI) / 180;
    this.staticGroup.add(group);
    this.addCollider(x - 1.05, x + 1.05, z - 0.15, z + 0.15);
  }

  private addScreen(x: number, z: number, rotation: number) {
    const group = new THREE.Group();
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.05, 0.09),
      new THREE.MeshStandardMaterial({
        color: PALETTE.ink,
        emissive: PALETTE.screen,
        emissiveIntensity: 0.35,
      })
    );
    panel.position.y = 1.45;
    group.add(panel);
    const image = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.5, 0.03),
      new THREE.MeshStandardMaterial({
        color: PALETTE.screen,
        emissive: PALETTE.screen,
        emissiveIntensity: 1.1,
      })
    );
    image.position.set(0, 1.45, 0.06);
    group.add(image);
    group.position.set(x, 0, z);
    group.rotation.y = (rotation * Math.PI) / 180;
    this.staticGroup.add(group);
    this.addCollider(x - 0.95, x + 0.95, z - 0.15, z + 0.15);
  }

  private addFocusDesk(x: number, z: number) {
    const group = new THREE.Group();
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.08, 0.8),
      new THREE.MeshStandardMaterial({ color: PALETTE.wood, roughness: 0.55 })
    );
    top.position.y = 0.74;
    group.add(top);
    for (const sx of [-0.75, 0.75]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.7, 0.07),
        new THREE.MeshStandardMaterial({ color: PALETTE.metal, metalness: 0.6 })
      );
      leg.position.set(sx, 0.35, 0);
      group.add(leg);
    }
    const divider = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.7, 0.06),
      new THREE.MeshStandardMaterial({
        color: PALETTE.slabTint,
        transparent: true,
        opacity: 0.9,
      })
    );
    divider.position.set(0, 1.15, -0.42);
    group.add(divider);
    group.position.set(x, 0, z);
    this.staticGroup.add(group);
    this.addCollider(x - 0.9, x + 0.9, z - 0.42, z + 0.42);
    this.addChair(x, z + 0.9, 180);
  }

  // --------------------------------------------------------------- input

  // ------------------------------------------------------------------ seats

  /** The chair, sofa, armchair or bean bag under the pointer, if any. */
  private seatUnderPointer(): THREE.Object3D | null {
    const hits = this.raycaster.intersectObjects(
      [this.buildingGroup, this.staticGroup, this.furnitureGroup],
      true
    );
    for (const hit of hits.slice(0, 1)) {
      let node: THREE.Object3D | null = hit.object;
      while (node && node.userData.seatHeight === undefined) {
        node = node.parent;
      }
      if (node) return node;
    }
    return null;
  }

  /**
   * Walks to a free spot beside the seat; the player sits once they arrive.
   * The front is tried first, then the sides, so a chair tucked under a desk
   * is still reachable.
   */
  private walkToSeat(seat: THREE.Object3D): boolean {
    const fx = Math.sin(seat.rotation.y);
    const fz = Math.cos(seat.rotation.y);
    const sides = [
      [fx, fz],
      [fz, -fx],
      [-fz, fx],
      [-fx, -fz],
    ];
    const spots = [0.85, 1.1, 1.35].flatMap((reach) =>
      sides.map(([dx, dz]) => ({
        x: seat.position.x + dx * reach,
        z: seat.position.z + dz * reach,
      }))
    );
    for (const { x, z } of spots) {
      if (this.isBlocked(x, z)) continue;
      const here = Math.hypot(
        x - this.playerPosition.x,
        z - this.playerPosition.z
      );
      const path =
        here < 0.3
          ? []
          : this.findPath(this.playerPosition.x, this.playerPosition.z, x, z);
      if (here >= 0.3 && !path.length) continue;
      this.path = path;
      this.pathIndex = 0;
      this.pendingSeat = seat;
      this.showMarker(x, z);
      return true;
    }
    return false;
  }

  /**
   * Placed furniture is rebuilt whenever a layout changes; keep sitting on the
   * new copy of the same chair. False when the seat is gone.
   */
  private followSeat(): boolean {
    const seat = this.seated;
    if (!seat) return false;
    if (seat.parent) return true;
    const id = seat.userData.furnitureId as string | undefined;
    const rebuilt = id ? this.furnitureMeshes.get(id) : undefined;
    if (!rebuilt?.parent || rebuilt.userData.seatHeight === undefined) {
      return false;
    }
    this.seated = rebuilt;
    return true;
  }

  private poseSeated(rig: AvatarRig, seat: THREE.Object3D, elapsed: number) {
    const height = seat.userData.seatHeight as number;
    const back = 0.06;
    rig.group.position.set(
      seat.position.x - Math.sin(seat.rotation.y) * back,
      height - 0.74,
      seat.position.z - Math.cos(seat.rotation.y) * back
    );
    rig.group.rotation.y = seat.rotation.y;
    this.playerYaw = seat.rotation.y;
    this.playerSpeed = 0;
    rig.leftLeg.rotation.x = -1.2;
    rig.rightLeg.rotation.x = -1.2;
    const breath = Math.sin(elapsed * 1.2 + rig.phase) * 0.03;
    rig.leftArm.rotation.x = -0.45 + breath;
    rig.rightArm.rotation.x = -0.45 - breath;
    rig.ring.visible = false;
  }

  private onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    this.keys.add(key);
    if (
      [
        "w",
        "a",
        "s",
        "d",
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright",
      ].includes(key)
    ) {
      this.path = [];
      this.lastInputAt = performance.now();
      event.preventDefault();
    }
    if (key === "shift") this.keys.add("shift");
  }

  private onKeyUp(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    this.keys.delete(key);
    if (key === "shift") this.keys.delete("shift");
  }

  private updatePointer(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private setTowerHover(office: TowerOffice | null) {
    this.tower?.setHovered(office?.roomId ?? null);
    if (this.towerHover === office) return;
    this.towerHover = office;
    this.callbacks.onTowerHover?.(office);
  }

  private updateTowerHover() {
    const point = this.towerPointer;
    const canvas = this.renderer.domElement;
    if (
      this.view !== "tower" ||
      this.pointerDown ||
      !point ||
      document.elementFromPoint(point.x, point.y) !== canvas
    ) {
      this.setTowerHover(null);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      this.setTowerHover(null);
      return;
    }
    this.pointerNdc.set(
      ((point.x - rect.left) / rect.width) * 2 - 1,
      -((point.y - rect.top) / rect.height) * 2 + 1
    );
    // Raycasting runs before render, so it needs the camera's new world matrix.
    this.camera.updateMatrixWorld();
    this.setTowerHover(this.tower?.pick(this.pointerNdc, this.camera) ?? null);
  }

  private onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    this.pointerDown = true;
    if (this.view === "tower") this.setTowerHover(null);
    this.pointerDragged = false;
    this.pointerStart = { x: event.clientX, y: event.clientY };
    this.updatePointer(event);
    if (this.editState.active && (this.ghostMesh || this.editState.movingId)) {
      this.updateGhostPosition();
    }
  }

  private onPointerMove(event: PointerEvent) {
    if (this.view === "tower") {
      this.towerPointer = { x: event.clientX, y: event.clientY };
      if (!this.pointerDown) {
        this.updateTowerHover();
        return;
      }
      const moveX = event.clientX - this.pointerStart.x;
      const moveY = event.clientY - this.pointerStart.y;
      if (Math.abs(moveX) + Math.abs(moveY) > 5) this.pointerDragged = true;
      if (this.pointerDragged) {
        this.cameraYaw -= moveX * 0.006;
        this.pointerStart = { x: event.clientX, y: event.clientY };
      }
      return;
    }

    if (!this.pointerDown) {
      if (
        this.editState.active &&
        (this.ghostMesh || this.editState.movingId)
      ) {
        this.updatePointer(event);
        this.updateGhostPosition();
      }
      return;
    }
    const dx = event.clientX - this.pointerStart.x;
    const dy = event.clientY - this.pointerStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) this.pointerDragged = true;
    if (this.pointerDragged && !this.editState.active) {
      this.cameraYaw -= dx * 0.006;
      this.cameraPitch = clamp(this.cameraPitch - dy * 0.004, 0.45, 1.2);
      this.pointerStart = { x: event.clientX, y: event.clientY };
    }
    if (this.ghostMesh || this.editState.movingId) {
      this.updatePointer(event);
      this.updateGhostPosition();
    }
  }

  private onPointerUp(event: PointerEvent) {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    const wasDrag = this.pointerDragged;
    this.pointerDragged = false;
    if (wasDrag) return;
    this.updatePointer(event);

    if (this.view === "tower") {
      const office = this.tower?.pick(this.pointerNdc, this.camera) ?? null;
      if (office) {
        this.callbacks.onTowerPick?.({
          roomId: office.roomId,
          floorIndex: office.floorIndex,
        });
      }
      return;
    }

    if (this.editState.active) {
      this.handleEditClick(event);
      return;
    }
    if (this.cinematic) return;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const seat = this.seatUnderPointer();
    if (seat) {
      if (!this.walkToSeat(seat)) this.callbacks.onInvalidTarget();
      return;
    }
    const intersections = this.raycaster.intersectObject(
      this.floorPlane,
      false
    );
    if (!intersections.length) return;
    const point = intersections[0].point;
    // Corridors need no named room. Reject restricted targets before snapping,
    // but let findPath snap furniture and wall clicks to nearby free floor.
    const insideFloor = this.walkBounds.some(
      (area) =>
        point.x >= area.minX &&
        point.x <= area.maxX &&
        point.z >= area.minZ &&
        point.z <= area.maxZ
    );
    const insideLockedRoom = this.allRooms.some(
      (room) =>
        room.locked &&
        (room.floorIndex ?? 0) === this.activeFloor &&
        point.x >= room.bounds.x &&
        point.x <= room.bounds.x + room.bounds.w &&
        point.z >= room.bounds.z &&
        point.z <= room.bounds.z + room.bounds.d
    );
    if (!insideFloor || insideLockedRoom) {
      this.callbacks.onInvalidTarget();
      return;
    }
    const path = this.findPath(
      this.playerPosition.x,
      this.playerPosition.z,
      point.x,
      point.z
    );
    if (!path.length) {
      this.callbacks.onInvalidTarget();
      return;
    }
    this.path = path;
    this.pathIndex = 0;
    this.pendingSeat = null;
    this.showMarker(point.x, point.z);
  }

  private onWheel(event: WheelEvent) {
    event.preventDefault();
    if (this.view === "tower") {
      this.towerPointer = { x: event.clientX, y: event.clientY };
      this.setTowerHover(null);
    }
    this.cameraDistance = clamp(
      this.cameraDistance + event.deltaY * 0.008,
      5.5,
      15
    );
  }

  private handleEditClick(event: PointerEvent) {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    if (this.editState.movingId || this.editState.catalogId) {
      this.placeGhost();
      return;
    }

    const hits = this.raycaster.intersectObjects(
      this.furnitureGroup.children,
      true
    );
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node && !node.userData.furnitureId) node = node.parent;
      if (node?.userData.furnitureId) {
        this.callbacks.onFurnitureSelect(node.userData.furnitureId as string);
        return;
      }
    }
    this.callbacks.onFurnitureSelect(null);
  }

  /**
   * Places (or moves) the item under the ghost. Only a green ghost is allowed
   * to commit, so what you see is exactly what gets built.
   */
  placeGhost(): boolean {
    if (!this.editState.active) return false;
    if (!this.ghostMesh || !this.ghostPoint) return false;
    if (!this.ghostValid) {
      this.callbacks.onGhostState?.(false, this.ghostReason);
      return false;
    }
    if (this.editState.movingId) {
      this.callbacks.onRequestMove(
        this.editState.movingId,
        this.ghostPoint.x,
        this.ghostPoint.z
      );
      return true;
    }
    if (this.editState.catalogId) {
      this.callbacks.onRequestPlace(this.ghostPoint.x, this.ghostPoint.z);
      return true;
    }
    return false;
  }

  private updateGhostPosition() {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const intersections = this.raycaster.intersectObject(
      this.floorPlane,
      false
    );
    if (!intersections.length) return;
    const point = intersections[0].point;
    // Snap to half tiles so the ghost and the placed item share a position.
    const x = Math.round(point.x * 2) / 2;
    const z = Math.round(point.z * 2) / 2;
    this.ghostPoint = { x, z };
    if (!this.ghostMesh) return;

    this.ghostMesh.position.set(x, 0, z);
    const catalogId =
      this.editState.movingCatalogId ?? this.editState.catalogId ?? null;
    const catalog = catalogId ? CATALOG_BY_ID[catalogId] : null;
    const rotation = catalog?.rotatable ? this.editState.rotation : 0;
    this.ghostMesh.rotation.y = (rotation * Math.PI) / 180;

    const reason = this.placementReason(x, z, catalogId, rotation);
    this.ghostValid = reason === null;
    this.ghostReason = reason;
    this.updateGhost(this.ghostValid);
    this.publishGhostState();
  }

  /**
   * Single source of truth for "can this go here?". Mirrors the rule used by
   * the React layer so a green ghost always places and a red ghost never does.
   */
  private placementReason(
    x: number,
    z: number,
    catalogId: string | null,
    rotation: number
  ): string | null {
    if (!catalogId) return null;
    const current = this.currentRoom;
    if (!current) return "Walk into a room to furnish it.";
    const hovered = this.roomAtPosition(x, z);
    if (!hovered || hovered.id !== current.id) {
      return "That spot is outside this room.";
    }
    const items = roomLayoutItems(this.furnitureItems, current).filter(
      (item) => item.id !== this.editState.movingId
    );
    return validatePlacement(items, catalogId, x, z, rotation, current);
  }

  private publishGhostState() {
    if (!this.callbacks.onGhostState) return;
    const key = `${this.ghostValid}|${this.ghostReason ?? ""}`;
    if (key === this.lastGhostState) return;
    this.lastGhostState = key;
    this.callbacks.onGhostState(this.ghostValid, this.ghostReason);
  }

  // ------------------------------------------------------------------ path

  private findPath(
    sx: number,
    sz: number,
    tx: number,
    tz: number
  ): Array<{ x: number; z: number }> {
    const cell = 0.5;
    const minX = this.planBounds.minX;
    const minZ = this.planBounds.minZ;
    const cols = Math.ceil(this.planWidth / cell);
    const rows = Math.ceil(this.planDepth / cell);
    const toCell = (x: number, z: number) => ({
      cx: clamp(Math.round((x - minX) / cell), 0, cols - 1),
      cz: clamp(Math.round((z - minZ) / cell), 0, rows - 1),
    });
    const start = toCell(sx, sz);
    const goal = toCell(tx, tz);
    const key = (cx: number, cz: number) => cz * cols + cx;
    const isFree = (cx: number, cz: number) => {
      const x = minX + cx * cell;
      const z = minZ + cz * cell;
      return !this.isBlocked(x, z, 0.28);
    };

    if (!isFree(goal.cx, goal.cz)) {
      let found = false;
      for (let radius = 1; radius <= 4 && !found; radius += 1) {
        for (let dx = -radius; dx <= radius && !found; dx += 1) {
          for (let dz = -radius; dz <= radius && !found; dz += 1) {
            if (isFree(goal.cx + dx, goal.cz + dz)) {
              goal.cx += dx;
              goal.cz += dz;
              found = true;
            }
          }
        }
      }
      if (!found) return [];
    }

    const open = new Map<number, PathNode>();
    const closed = new Set<number>();
    const startNode: PathNode = {
      x: start.cx,
      z: start.cz,
      g: 0,
      f: 0,
      parent: null,
    };
    open.set(key(start.cx, start.cz), startNode);

    const neighbors = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];

    let iterations = 0;
    while (open.size && iterations < 9000) {
      iterations += 1;
      let current: PathNode | null = null;
      for (const node of open.values()) {
        if (!current || node.f < current.f) current = node;
      }
      if (!current) break;
      if (current.x === goal.cx && current.z === goal.cz) {
        const path: Array<{ x: number; z: number }> = [];
        let node: PathNode | null = current;
        while (node) {
          path.push({ x: minX + node.x * cell, z: minZ + node.z * cell });
          node = node.parent;
        }
        path.reverse();
        return this.smoothPath(path);
      }
      open.delete(key(current.x, current.z));
      closed.add(key(current.x, current.z));

      for (const [dx, dz] of neighbors) {
        const nx = current.x + dx;
        const nz = current.z + dz;
        if (nx < 0 || nx >= cols || nz < 0 || nz >= rows) continue;
        if (closed.has(key(nx, nz))) continue;
        if (!isFree(nx, nz)) continue;
        if (
          dx !== 0 &&
          dz !== 0 &&
          (!isFree(current.x + dx, current.z) ||
            !isFree(current.x, current.z + dz))
        ) {
          continue;
        }
        const step = dx !== 0 && dz !== 0 ? 1.414 : 1;
        const g = current.g + step;
        const existing = open.get(key(nx, nz));
        if (existing && existing.g <= g) continue;
        const h = Math.hypot(goal.cx - nx, goal.cz - nz);
        const node: PathNode = {
          x: nx,
          z: nz,
          g,
          f: g + h,
          parent: current,
        };
        open.set(key(nx, nz), node);
      }
    }
    return [];
  }

  private smoothPath(
    path: Array<{ x: number; z: number }>
  ): Array<{ x: number; z: number }> {
    if (path.length < 3) return path;
    const result: Array<{ x: number; z: number }> = [path[0]];
    let anchor = 0;
    while (anchor < path.length - 1) {
      let next = path.length - 1;
      for (; next > anchor + 1; next -= 1) {
        if (this.lineOfSight(path[anchor], path[next])) break;
      }
      result.push(path[next]);
      anchor = next;
    }
    return result;
  }

  private lineOfSight(
    a: { x: number; z: number },
    b: { x: number; z: number }
  ): boolean {
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(distance / 0.25);
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      if (this.isBlocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.3)) {
        return false;
      }
    }
    return true;
  }

  private showMarker(x: number, z: number) {
    if (this.marker) {
      this.buildingGroup.remove(this.marker);
      this.marker.geometry.dispose();
      (this.marker.material as THREE.Material).dispose();
    }
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.28, 24),
      new THREE.MeshBasicMaterial({
        color: 0xa78bfa,
        transparent: true,
        opacity: 0.85,
      })
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(x, 0.07, z);
    marker.name = "click-marker";
    this.buildingGroup.add(marker);
    this.marker = marker;
    this.markerUntil = performance.now() + 900;
  }

  // ------------------------------------------------------------------ loop

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;
    this.cinemaTime += dt;

    // The tower is the same scene seen from outside: the floor and its people
    // are hidden, so only the tower animates.
    if (this.view === "tower") {
      this.tower?.update(elapsed);
      this.updateTowerCamera(dt);
      this.updateTowerHover();
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.updatePlayer(dt, elapsed);
    this.updateAgents(dt, elapsed);
    this.updateZoe(elapsed);
    this.updateBubbles();
    this.updateLabels();
    this.updateCamera(dt);
    this.updateMarker();
    this.updateRoomCheck();
    this.updateProximity();
    this.updateFloorLights();

    if (performance.now() - this.lastPresencePush > 180) {
      this.lastPresencePush = performance.now();
      this.pushPresence();
    }

    this.renderer.render(this.scene, this.camera);
  };

  private updatePlayer(dt: number, elapsed: number) {
    if (!this.playerRig) return;
    if (this.cinematic) {
      this.playerRig.group.position.set(
        this.playerPosition.x,
        0,
        this.playerPosition.z
      );
      this.animateRig(this.playerRig, 0, elapsed);
      return;
    }

    let inputX = 0;
    let inputZ = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) inputZ -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) inputZ += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) inputX -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) inputX += 1;
    inputX += this.joystick.x;
    inputZ += this.joystick.y;

    const hasInput = Math.abs(inputX) + Math.abs(inputZ) > 0.05;
    if (
      this.seated &&
      (hasInput ||
        this.path.length ||
        this.pendingSeat ||
        this.editState.active ||
        !this.followSeat())
    ) {
      this.seated = null;
    }
    if (this.seated) {
      this.poseSeated(this.playerRig, this.seated, elapsed);
      this.pushPosition();
      return;
    }
    if (hasInput) {
      this.pendingSeat = null;
      this.path = [];
      const length = Math.hypot(inputX, inputZ) || 1;
      inputX /= length;
      inputZ /= length;
      const forwardX = -Math.sin(this.cameraYaw);
      const forwardZ = -Math.cos(this.cameraYaw);
      const rightX = Math.cos(this.cameraYaw);
      const rightZ = -Math.sin(this.cameraYaw);
      const moveX = rightX * inputX + forwardX * -inputZ;
      const moveZ = rightZ * inputX + forwardZ * -inputZ;
      const targetSpeed = this.keys.has("shift") ? 5.2 : 3;
      this.playerVelocity.x +=
        (moveX * targetSpeed - this.playerVelocity.x) * Math.min(dt * 12, 1);
      this.playerVelocity.y +=
        (moveZ * targetSpeed - this.playerVelocity.y) * Math.min(dt * 12, 1);
    } else if (this.path.length) {
      const target = this.path[this.pathIndex];
      if (!target) {
        this.path = [];
      } else {
        const dx = target.x - this.playerPosition.x;
        const dz = target.z - this.playerPosition.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.28) {
          this.pathIndex += 1;
          if (this.pathIndex >= this.path.length) this.path = [];
        } else {
          const targetSpeed = 3.4;
          this.playerVelocity.x +=
            ((dx / distance) * targetSpeed - this.playerVelocity.x) *
            Math.min(dt * 10, 1);
          this.playerVelocity.y +=
            ((dz / distance) * targetSpeed - this.playerVelocity.y) *
            Math.min(dt * 10, 1);
        }
      }
    } else {
      this.playerVelocity.x *= Math.max(0, 1 - dt * 12);
      this.playerVelocity.y *= Math.max(0, 1 - dt * 12);
      if (Math.abs(this.playerVelocity.x) < 0.02) this.playerVelocity.x = 0;
      if (Math.abs(this.playerVelocity.y) < 0.02) this.playerVelocity.y = 0;
    }

    const speed = Math.hypot(this.playerVelocity.x, this.playerVelocity.y);
    if (speed > 0.01) {
      this.resolveMove(this.playerVelocity.x * dt, this.playerVelocity.y * dt);
      this.playerYaw = Math.atan2(this.playerVelocity.x, this.playerVelocity.y);
    }
    this.playerSpeed = speed;

    if (this.pendingSeat && !this.path.length) {
      const seat = this.pendingSeat;
      this.pendingSeat = null;
      const near =
        Math.hypot(
          seat.position.x - this.playerPosition.x,
          seat.position.z - this.playerPosition.z
        ) < 1.8;
      if (seat.parent && near) {
        this.seated = seat;
        this.playerVelocity.set(0, 0);
      }
    }

    this.playerRig.group.position.set(
      this.playerPosition.x,
      0,
      this.playerPosition.z
    );
    const yawDelta =
      ((this.playerYaw - this.playerRig.group.rotation.y + Math.PI * 3) %
        (Math.PI * 2)) -
      Math.PI;
    this.playerRig.group.rotation.y += yawDelta * Math.min(dt * 14, 1);
    this.animateRig(this.playerRig, speed, elapsed);
    (this.playerRig.ring.material as THREE.MeshBasicMaterial).color.setHex(
      STATUS_COLORS[this.playerStatus]
    );
    this.playerRig.ring.visible = true;
    const arrow = this.playerRig.group.getObjectByName("player-arrow");
    if (arrow) arrow.rotation.y = elapsed * 1.5;

    this.pushPosition();
  }

  private updateAgents(dt: number, elapsed: number) {
    const now = performance.now();
    for (const agent of this.agents) {
      const { user, rig } = agent;
      let speed = 0;
      if (
        user.waypoints &&
        user.waypoints.length > 0 &&
        now > agent.pauseUntil
      ) {
        const target =
          user.waypoints[agent.targetIndex % user.waypoints.length];
        const dx = target.x - user.position.x;
        const dz = target.z - user.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.15) {
          agent.targetIndex = (agent.targetIndex + 1) % user.waypoints.length;
          agent.pauseUntil = now + 1400 + Math.random() * 2800;
        } else {
          const step = Math.min(agent.speed * dt, distance);
          user.position.x += (dx / distance) * step;
          user.position.z += (dz / distance) * step;
          speed = agent.speed;
          const targetYaw = Math.atan2(dx, dz);
          const yawDelta =
            ((targetYaw - rig.group.rotation.y + Math.PI * 3) % (Math.PI * 2)) -
            Math.PI;
          rig.group.rotation.y += yawDelta * Math.min(dt * 8, 1);
        }
      }
      rig.group.position.set(user.position.x, 0, user.position.z);
      this.animateRig(rig, speed, elapsed);
      const room = this.roomAtPosition(user.position.x, user.position.z);
      if (room) user.roomId = room.id;
    }
  }

  private updateZoe(elapsed: number) {
    if (!this.zoeRig) return;
    this.animateRig(this.zoeRig, 0, elapsed);
    const halo = this.zoeRig.group.getObjectByName("zoe-halo");
    if (halo) halo.rotation.z = elapsed * 0.4;
    const diamond = this.zoeRig.group.getObjectByName("zoe-diamond");
    if (diamond) {
      diamond.rotation.y = elapsed * 0.9;
      diamond.position.y = 2.85 + Math.sin(elapsed * 1.6) * 0.06;
    }
    const range = this.buildingGroup.getObjectByName("zoe-range");
    if (range) {
      const material = (range as THREE.Mesh)
        .material as THREE.MeshBasicMaterial;
      material.opacity = 0.25 + Math.sin(elapsed * 2.2) * 0.12;
    }
  }

  private updateBubbles() {
    const now = performance.now();
    const rigs = [
      this.playerRig,
      ...this.agents.map((agent) => agent.rig),
      this.zoeRig,
    ];
    for (const rig of rigs) {
      if (!rig?.bubble) continue;
      if (now > rig.bubble.until) {
        rig.group.remove(rig.bubble.sprite);
        rig.bubble.material.dispose();
        rig.bubble.texture.dispose();
        rig.bubble = undefined;
      } else {
        const remaining = rig.bubble.until - now;
        rig.bubble.material.opacity = remaining < 700 ? remaining / 700 : 1;
        rig.bubble.sprite.position.y = 2.75 + Math.sin(now * 0.002) * 0.03;
      }
    }
  }

  /**
   * A room sign that fills the screen when the camera drifts through it reads
   * as a wall, not a label. Fade the demo signs out near the camera and at the
   * far edge of the building.
   */
  private updateLabels() {
    for (const sprite of this.labelSprites) {
      const distance = this.camera.position.distanceTo(sprite.position);
      const near = clamp((distance - 2.2) / 2.6, 0, 1);
      const far = 1 - clamp((distance - 38) / 16, 0, 1);
      const material = sprite.material as THREE.SpriteMaterial;
      material.opacity = near * far;
      material.transparent = true;
      sprite.visible = material.opacity > 0.03;
    }
  }

  /** Frame the whole tower, or the storey a search or lift is focused on. */
  private updateTowerCamera(dt: number) {
    const tower = this.tower;
    if (!tower) return;

    const focused = tower.focusedFloorIndex;
    const framed = tower.roomIsFramed;
    const targetY = tower.focusY;
    const targetX = tower.focusX;
    const height = Math.max(tower.height, 6);
    // Three framings: the whole tower, one storey, one office. Each step in
    // narrows the slice of the facade in frame — if the width of the building
    // kept setting the distance, clicking a storey would only recentre the
    // camera and never actually zoom.
    const halfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const halfWidth = halfFov * Math.max(this.camera.aspect, 0.5);
    const storey = height / Math.max(tower.floorCount, 1);
    const spanWidth =
      focused === null
        ? tower.width * 0.82 + tower.depth * 0.58 + 10
        : framed
          ? Math.min(tower.width * 0.3, 9)
          : tower.width * 0.62;
    const spanHeight =
      focused === null ? height + 5 : framed ? storey + 3.5 : storey + 8;
    const distance = Math.max(
      focused === null ? 24 : framed ? 9 : 16,
      (spanWidth / 2 / halfWidth) * 1.12,
      (spanHeight / 2 / halfFov) * 1.12
    );
    // Straight-on elevation, not a three-quarter view: the facade faces the
    // viewer and the camera slides along it to reach the office in frame.
    const lift = focused === null ? 1.6 : 0.9;
    const desired = new THREE.Vector3(targetX, targetY + lift, distance);

    this.cameraPosition.lerp(desired, Math.min(dt * 3, 1));
    this.cameraTarget.lerp(
      new THREE.Vector3(targetX, targetY + (focused === null ? 0.6 : 0), 0),
      Math.min(dt * 3, 1)
    );
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraTarget);
  }

  private updateCamera(dt: number) {
    if (this.cinematic) {
      const center = this.planCenter;
      const radius = Math.max(this.planWidth, this.planDepth) * 0.55 + 18;
      const angle = this.cinemaTime * 0.12 + 0.6;
      const desired = new THREE.Vector3(
        center.x + Math.sin(angle) * radius,
        radius * 0.72,
        center.z + Math.cos(angle) * radius
      );
      this.camera.position.lerp(desired, Math.min(dt * 2, 1));
      this.cameraTarget.lerp(
        new THREE.Vector3(center.x, 1.2, center.z),
        Math.min(dt * 2, 1)
      );
      this.camera.lookAt(this.cameraTarget);
      return;
    }

    const focus = new THREE.Vector3(
      this.playerPosition.x,
      1.25,
      this.playerPosition.z
    );
    const horizontal = Math.cos(this.cameraPitch) * this.cameraDistance;
    const vertical = Math.sin(this.cameraPitch) * this.cameraDistance;
    const desired = new THREE.Vector3(
      focus.x + Math.sin(this.cameraYaw) * horizontal,
      focus.y + vertical,
      focus.z + Math.cos(this.cameraYaw) * horizontal
    );
    this.cameraPosition.lerp(desired, Math.min(dt * 5, 1));
    this.cameraTarget.lerp(focus, Math.min(dt * 8, 1));
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraTarget);
  }

  private updateMarker() {
    if (this.marker && performance.now() > this.markerUntil) {
      this.buildingGroup.remove(this.marker);
      this.marker.geometry.dispose();
      (this.marker.material as THREE.Material).dispose();
      this.marker = null;
    }
  }

  private updateRoomCheck() {
    const now = performance.now();
    if (now - this.lastRoomCheck < 200) return;
    this.lastRoomCheck = now;
    const room = this.roomAtPosition(
      this.playerPosition.x,
      this.playerPosition.z
    );
    const nextRoom = room ?? null;
    if (nextRoom?.id !== this.currentRoom?.id) {
      this.currentRoom = nextRoom;
      if (nextRoom?.kind === "focus") {
        this.playerStatus = "dnd";
      } else if (nextRoom?.kind === "meeting") {
        this.playerStatus = "call";
      } else {
        this.playerStatus = "online";
      }
      this.callbacks.onRoomChange(nextRoom);
    }
  }

  private updateProximity() {
    const distance = Math.hypot(
      this.playerPosition.x - this.zoePosition.x,
      this.playerPosition.z - this.zoePosition.z
    );
    // Zoe only exists in reception on the general floor.
    const near = (!this.isLive || this.activeFloor === 0) && distance < 2.75;
    if (near !== this.nearZoe) {
      this.nearZoe = near;
      this.callbacks.onZoeProximity(near);
    }
  }

  private pushPosition(force = false) {
    const now = performance.now();
    if (!force && now - this.lastPositionPush < 90) return;
    this.lastPositionPush = now;
    this.callbacks.onPosition(
      this.playerPosition.x,
      this.playerPosition.z,
      this.playerYaw
    );
  }

  private pushPresence() {
    // In live mode the FE source owns the roster; the engine only renders.
    if (this.isLive) return;

    this.callbacks.onPresence(
      this.agents.map((agent) => ({
        id: agent.user.id,
        x: agent.user.position.x,
        z: agent.user.position.z,
        roomId: agent.user.roomId,
        status: agent.user.status,
      }))
    );
  }

  private resize() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  // ------------------------------------------------------------------ debug

  getDiagnostics() {
    return {
      colliders: this.colliders.length,
      furniture: this.furnitureMeshes.size,
      agents: this.agents.length,
      player: { x: this.playerPosition.x, z: this.playerPosition.z },
      room: this.currentRoom?.id ?? null,
    };
  }
}

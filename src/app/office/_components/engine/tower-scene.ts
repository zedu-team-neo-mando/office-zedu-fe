import * as THREE from "three";

import type { OfficeFloor } from "~/types/office";
import { PALETTE } from "./palette";

/**
 * The tower is the organisation seen from the street.
 *
 * It is a cutaway, not a facade of flat coloured panes: every storey opens
 * onto full-height private offices with a desk, a chair, a plant and the face
 * of the person who sits there. The building is always warm and lit; presence
 * is carried by the person at the desk and by their status dot, never by
 * leaving a colleague's room dark.
 *
 * The tower owns only the shell, the office cells and their labels. The lift,
 * the camera and the interaction live in the engine.
 */

export interface TowerOffice {
  roomId: string;
  floorIndex: number;
  name: string;
  kind: string;
  /** Who the office belongs to. A private office always has one. */
  occupantName?: string;
  /** Whether that person is standing in it right now. */
  present?: boolean;
  status?: "online" | "idle" | "away" | "call" | "dnd";
  tint?: string;
  /** Portrait of the person who owns the office, when the source has one. */
  avatarUrl?: string;
  /** False for decorative offices the demo fills a storey with. */
  interactive?: boolean;
  /** The signed-in person's own office, marked so the tower can label it. */
  isSelf?: boolean;
}

const STATUS_COLORS: Record<string, number> = {
  online: 0x2fbf8f,
  idle: 0xe3a23b,
  away: 0x9aa8a2,
  call: 0x4d9fe8,
  dnd: 0xe25d6b,
};

const FLOOR_HEIGHT = 4.8;
const SLAB = 0.4;
const TOWER_WIDTH = 30;
const TOWER_DEPTH = 11;
const FACADE_Z = TOWER_DEPTH / 2;
const CELL_INSET = 1.55;
const INNER_PAD_X = 0.65;
const INNER_PAD_Y = 0.3;
const CELL_GAP = 0.055;
const LIFT_WIDTH = 1.35;
const LIFT_DEPTH = 2.7;

// Twelve offices fill a storey without turning them into cubicles: a wing of
// eleven people is one generous row, and forty people wrap into four rows.
const PERSONAL_PER_ROW = 12;
const CHANNEL_PER_ROW = 6;

function floorY(floors: OfficeFloor[], index: number): number {
  // The general floor (index 0) is on top and the tower grows downwards.
  const top = Math.max(...floors.map((floor) => floor.index), 0);
  return (top - index) * (FLOOR_HEIGHT + SLAB);
}

function isTowerRoom(office: TowerOffice): boolean {
  // Every directory room has a window on the tower. The per-floor extras
  // ("area" rooms) belong to the 2D plan, not to the office stack.
  return office.kind !== "area";
}

function isLit(office: TowerOffice): boolean {
  // Personal offices of inactive or away users are dimmed, while active
  // users and shared spaces stay warmly lit.
  if (!isTowerRoom(office)) return false;
  if (office.kind !== "personal") return true;
  return Boolean(office.present && office.status !== "away");
}

function statusColor(status?: string): number {
  return STATUS_COLORS[status ?? "online"] ?? STATUS_COLORS.online;
}

/** A stable 0..1 value per cell, so the tower does not flicker between frames. */
function noise(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Split a storey's rooms into rows that use the full facade. The last row is
 * allowed to be shorter only when the rooms cannot divide evenly.
 */
function rowCounts(count: number, maxPerRow: number): number[] {
  const rows = Math.max(1, Math.ceil(count / maxPerRow));
  const perRow = Math.ceil(count / rows);
  const counts: number[] = [];
  let remaining = count;
  for (let row = 0; row < rows && remaining > 0; row += 1) {
    const size = Math.min(perRow, remaining);
    counts.push(size);
    remaining -= size;
  }
  return counts;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function plateSprite(text: string, color = "#f7faf7"): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    roundedRect(ctx, 2, 10, canvas.width - 4, canvas.height - 20, 20);
    ctx.fillStyle = "rgba(24, 35, 31, 0.82)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = "600 38px Inter, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const clipped = text.length > 26 ? `${text.slice(0, 25)}\u2026` : text;
    ctx.fillText(clipped, 22, canvas.height / 2 + 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    })
  );
  sprite.scale.set(2.6, 0.49, 1);
  return sprite;
}

/** "Ada Obi" -> "AO", the label used when a source has no portrait. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarTexture(
  name: string,
  tint: string,
  present: boolean,
  self: boolean
): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fillStyle = present ? tint : "#c4cec8";
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = self
      ? "#f2c96a"
      : present
        ? "rgba(255, 255, 255, 0.85)"
        : "rgba(255, 255, 255, 0.5)";
    ctx.stroke();

    ctx.fillStyle = present ? "#fffdf8" : "#4c5c55";
    ctx.font = "700 44px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initialsOf(name), 64, 68);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * The occupant's portrait. The face is drawn into a canvas so it is cropped
 * like an avatar rather than squashed into a square, and the initials stay
 * visible until the image has loaded. There is deliberately no cache: a
 * texture belongs to one sprite and is disposed with it.
 */
function portraitTexture(
  url: string,
  name: string,
  tint: string,
  self: boolean
): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.beginPath();
    ctx.arc(80, 80, 72, 0, Math.PI * 2);
    ctx.fillStyle = tint;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = self ? "#f2c96a" : "rgba(255, 255, 255, 0.75)";
    ctx.stroke();

    ctx.fillStyle = "#fffdf8";
    ctx.font = "700 52px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initialsOf(name), 80, 86);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => {
    if (!ctx) return;
    const size = Math.min(image.width, image.height);
    const sx = (image.width - size) / 2;
    const sy = (image.height - size) / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.beginPath();
    ctx.arc(80, 80, 72, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(image, sx, sy, size, size, 8, 8, 144, 144);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(80, 80, 72, 0, Math.PI * 2);
    ctx.lineWidth = 6;
    ctx.strokeStyle = self ? "#f2c96a" : "rgba(255, 255, 255, 0.8)";
    ctx.stroke();
    texture.needsUpdate = true;
  };
  image.src = url;

  return texture;
}

/** The storey tag on the left edge: L for the general floor, F1..Fn above it. */
function tagSprite(text: string, accent: boolean): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    roundedRect(ctx, 18, 18, 156, 156, 42);
    ctx.fillStyle = accent
      ? "rgba(45, 118, 99, 0.96)"
      : "rgba(31, 43, 39, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = "#f6faf7";
    ctx.font = "700 74px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    })
  );
  sprite.scale.set(1.05, 1.05, 1);
  return sprite;
}

interface OfficeCell {
  office: TowerOffice;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  rect: CellRect;
  statusDot?: THREE.Mesh;
  plate?: THREE.Sprite;
  avatar?: THREE.Sprite;
  ceilingLight?: THREE.Mesh;
  ceilingMaterial?: THREE.MeshStandardMaterial;
  floorMaterial?: THREE.MeshStandardMaterial;
  baseWallColor: THREE.Color;
  warmth: number;
}

interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  col: number;
}

export class TowerScene {
  readonly group = new THREE.Group();

  private shell = new THREE.Group();
  private cells = new Map<string, OfficeCell>();
  private cellMeshes: THREE.Mesh[] = [];
  private floorSlabs = new Map<number, THREE.Mesh>();
  private floors: OfficeFloor[] = [];
  private structureKey = "";
  private hovered: string | null = null;
  private pulsed: string | null = null;
  private pulsedUntil = 0;
  private tintedFloor: number | null = null;
  private focusedFloor: number | null = null;
  private focusedRoom: string | null = null;
  private liftCar: THREE.Mesh | null = null;
  private liftY = 0;
  private liftTargetY = 0;
  private lastElapsed = 0;
  private beacon: THREE.Mesh | null = null;
  private sun: THREE.DirectionalLight;

  constructor() {
    this.group.name = "office-tower";
    this.group.add(this.shell);

    // The tower is shown against a daylight sky, so it gets its own soft
    // daylight. The lights travel with the tower group and disappear with it
    // when the camera steps back inside.
    this.group.add(new THREE.HemisphereLight(0xffffff, 0xe6ded0, 1.5));

    this.sun = new THREE.DirectionalLight(0xfff2dc, 2.1);
    this.sun.position.set(14, 34, 26);
    this.group.add(this.sun);
    this.group.add(this.sun.target);
  }

  get height(): number {
    const top = this.floors.length
      ? Math.max(...this.floors.map((floor) => floor.index))
      : 0;
    return (top + 1) * (FLOOR_HEIGHT + SLAB);
  }

  get width(): number {
    return TOWER_WIDTH;
  }

  get depth(): number {
    return TOWER_DEPTH;
  }

  get floorCount(): number {
    return this.floors.length;
  }

  get focusedFloorIndex(): number | null {
    return this.focusedFloor;
  }

  /** Rebuild the tower from the directory and the rooms on every floor. */
  setData(floors: OfficeFloor[], offices: TowerOffice[]) {
    // The general floor is always the top one, so ordering is fixed here.
    const nextFloors = floors.length
      ? [...floors].sort((a, b) => a.index - b.index)
      : [
          {
            index: 0,
            kind: "general" as const,
            name: "General",
            capacity: 0,
            members: 0,
            hasPortal: false,
          },
        ];
    const nextOffices = offices.filter(isTowerRoom);
    const key = `${nextFloors
      .map((floor) => `${floor.index}:${floor.kind}:${floor.members}`)
      .join("|")}#${nextOffices
      .map((office) => `${office.roomId}:${office.floorIndex}:${office.kind}`)
      .join(",")}`;

    // Presence republishes the roster several times a second. Only the people
    // in offices change, so the geometry is rebuilt only when the structure
    // or the person in an office changes.
    if (key === this.structureKey && this.floors.length) {
      this.syncOccupants(nextOffices);
      return;
    }

    this.structureKey = key;
    this.rebuild(nextFloors, nextOffices);
  }

  private rebuild(floors: OfficeFloor[], offices: TowerOffice[]) {
    this.clearShell();
    this.floors = floors;

    for (const floor of floors) {
      this.buildFloor(floor);
    }
    this.buildStructure();

    const byFloor = new Map<number, TowerOffice[]>();
    for (const office of offices) {
      const list = byFloor.get(office.floorIndex);
      if (list) list.push(office);
      else byFloor.set(office.floorIndex, [office]);
    }
    for (const floor of floors) {
      this.buildFloorCells(floor, byFloor.get(floor.index) ?? []);
    }

    if (
      this.focusedFloor !== null &&
      !floors.some((floor) => floor.index === this.focusedFloor)
    ) {
      this.focusedFloor = null;
    }
    this.applyFloorTint();

    const top = Math.max(...floors.map((floor) => floor.index), 0);
    this.liftY = floorY(floors, top) + SLAB + FLOOR_HEIGHT / 2;
    this.liftTargetY = this.liftY;
    if (this.liftCar) this.liftCar.position.y = this.liftY;
  }

  /** Update who is in which office without rebuilding the whole tower. */
  private syncOccupants(offices: TowerOffice[]) {
    const byId = new Map(offices.map((office) => [office.roomId, office]));
    let needsRebuild = false;

    for (const [id, cell] of this.cells) {
      const next = byId.get(id);
      if (!next) {
        needsRebuild = true;
        break;
      }
      if (
        Boolean(next.present) !== Boolean(cell.office.present) ||
        next.occupantName !== cell.office.occupantName ||
        next.avatarUrl !== cell.office.avatarUrl ||
        next.isSelf !== cell.office.isSelf ||
        Boolean(next.interactive) !== Boolean(cell.office.interactive)
      ) {
        needsRebuild = true;
        break;
      }
    }

    if (needsRebuild) {
      this.rebuild(this.floors, offices);
      return;
    }

    for (const [id, cell] of this.cells) {
      const next = byId.get(id);
      if (!next) continue;
      cell.office = next;
      if (cell.statusDot) {
        const material = cell.statusDot.material as THREE.MeshBasicMaterial;
        material.color.setHex(
          next.present ? statusColor(next.status) : STATUS_COLORS.away
        );
      }
      const style = this.cellStyle(
        cell.office,
        cell.baseWallColor,
        cell.warmth
      );
      if (cell.ceilingMaterial) {
        cell.ceilingMaterial.color.setHex(style.ceilingColor);
        cell.ceilingMaterial.emissive.setHex(style.ceilingEmissive);
        cell.ceilingMaterial.emissiveIntensity = style.ceilingIntensity;
      }
      cell.material.color.copy(style.wallColor);
      cell.material.emissive.setHex(style.wallEmissive);
      if (this.hovered !== id) {
        cell.material.emissiveIntensity = style.wallIntensity;
      }
      if (cell.floorMaterial) {
        cell.floorMaterial.color.setHex(style.floorColor);
      }
    }
  }

  // ------------------------------------------------------------------ shell

  private buildFloor(floor: OfficeFloor) {
    const y = floorY(this.floors, floor.index);
    const general = floor.kind === "general";

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(TOWER_WIDTH, SLAB, TOWER_DEPTH),
      new THREE.MeshStandardMaterial({
        color: general ? 0x46574f : PALETTE.slab,
        roughness: 0.86,
        metalness: 0.08,
      })
    );
    slab.position.set(0, y + SLAB / 2, 0);
    this.shell.add(slab);
    this.floorSlabs.set(floor.index, slab);

    // A thin brass edge catches the daylight and separates the storeys.
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(TOWER_WIDTH + 0.04, 0.07, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0xd8bd8a,
        metalness: 0.55,
        roughness: 0.35,
      })
    );
    edge.position.set(0, y + SLAB - 0.035, FACADE_Z + 0.03);
    this.shell.add(edge);

    const back = new THREE.Mesh(
      new THREE.BoxGeometry(TOWER_WIDTH, FLOOR_HEIGHT, 0.4),
      new THREE.MeshStandardMaterial({
        color: general ? 0x3b4b44 : PALETTE.frameDark,
        roughness: 0.95,
      })
    );
    back.position.set(0, y + SLAB + FLOOR_HEIGHT / 2, -TOWER_DEPTH / 2 + 0.2);
    this.shell.add(back);

    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, FLOOR_HEIGHT, TOWER_DEPTH),
        new THREE.MeshStandardMaterial({
          color: PALETTE.frameDark,
          roughness: 0.95,
        })
      );
      wall.position.set(
        (side * TOWER_WIDTH) / 2 - side * 0.2,
        y + SLAB + FLOOR_HEIGHT / 2,
        0
      );
      this.shell.add(wall);
    }

    // The general floor is tagged L, the member floors F1..Fn.
    const tag = tagSprite(general ? "L" : `F${floor.index}`, general);
    tag.position.set(-TOWER_WIDTH / 2 - 1.65, y + SLAB + FLOOR_HEIGHT / 2, 0);
    this.shell.add(tag);

    if (floor.hasPortal) {
      const portal = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2, 2.1),
        new THREE.MeshStandardMaterial({
          color: PALETTE.accent,
          emissive: 0x69b79d,
          emissiveIntensity: 0.55,
          side: THREE.DoubleSide,
        })
      );
      portal.position.set(
        TOWER_WIDTH / 2 - 2,
        y + SLAB + 1.15,
        FACADE_Z + 0.02
      );
      this.shell.add(portal);
    }
  }

  /** The parts that make the stack read as a building: site, roof, lift. */
  private buildStructure() {
    const height = this.height;

    const site = new THREE.Mesh(
      new THREE.PlaneGeometry(TOWER_WIDTH * 9, TOWER_WIDTH * 6),
      new THREE.MeshStandardMaterial({
        color: PALETTE.site,
        roughness: 1,
        metalness: 0,
      })
    );
    site.rotation.x = -Math.PI / 2;
    site.position.set(0, -1.4, 0);
    this.shell.add(site);

    // A few low blocks around the plaza keep the tower from floating in an
    // empty world, without competing with the building itself.
    for (let index = 0; index < 7; index += 1) {
      const blockHeight = 2 + noise(index + 3) * 7;
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(3 + noise(index) * 5, blockHeight, 3),
        new THREE.MeshStandardMaterial({ color: PALETTE.skyline, roughness: 1 })
      );
      const side = index % 2 === 0 ? -1 : 1;
      block.position.set(
        side * (20 + noise(index + 7) * 18),
        blockHeight / 2 - 1.4,
        -18 + noise(index + 11) * 26
      );
      this.shell.add(block);
    }

    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(TOWER_WIDTH + 2.8, 1.4, TOWER_DEPTH + 2.2),
      new THREE.MeshStandardMaterial({
        color: PALETTE.frameDark,
        roughness: 0.9,
      })
    );
    plinth.position.set(0, -0.7, 0);
    this.shell.add(plinth);

    const baseGlow = new THREE.Mesh(
      new THREE.BoxGeometry(TOWER_WIDTH + 3.1, 0.08, TOWER_DEPTH + 2.5),
      new THREE.MeshStandardMaterial({
        color: 0x9bc4ad,
        emissive: 0x9bc4ad,
        emissiveIntensity: 0.45,
        roughness: 0.6,
      })
    );
    baseGlow.position.set(0, -1.37, 0);
    this.shell.add(baseGlow);

    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        const pillar = new THREE.Mesh(
          new THREE.BoxGeometry(0.44, height, 0.44),
          new THREE.MeshStandardMaterial({
            color: PALETTE.frame,
            emissive: 0x2f4b40,
            emissiveIntensity: 0.18,
            roughness: 0.72,
          })
        );
        pillar.position.set(
          (x * TOWER_WIDTH) / 2,
          height / 2,
          (z * TOWER_DEPTH) / 2
        );
        this.shell.add(pillar);
      }
    }

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(TOWER_WIDTH + 1.5, 0.55, TOWER_DEPTH + 1.1),
      new THREE.MeshStandardMaterial({ color: PALETTE.frame, roughness: 0.85 })
    );
    roof.position.set(0, height + 0.28, 0);
    this.shell.add(roof);

    // The roof garden: planter boxes rather than a black plant room.
    for (let index = 0; index < 3; index += 1) {
      const planter = new THREE.Mesh(
        new THREE.BoxGeometry(TOWER_WIDTH * 0.18, 0.55, 1.1),
        new THREE.MeshStandardMaterial({ color: 0x8d7257, roughness: 0.95 })
      );
      planter.position.set(
        (index - 1) * TOWER_WIDTH * 0.22,
        height + 0.85,
        0.6
      );
      this.shell.add(planter);

      const hedge = new THREE.Mesh(
        new THREE.SphereGeometry(0.7, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x5d9260, roughness: 0.95 })
      );
      hedge.scale.set(1.5, 0.65, 0.8);
      hedge.position.set((index - 1) * TOWER_WIDTH * 0.22, height + 1.22, 0.6);
      this.shell.add(hedge);
    }

    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.09, 3, 8),
      new THREE.MeshStandardMaterial({ color: 0x41534c, roughness: 0.6 })
    );
    mast.position.set(TOWER_WIDTH * 0.32, height + 2.4, 0);
    this.shell.add(mast);

    this.beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xe25d6b })
    );
    this.beacon.position.set(TOWER_WIDTH * 0.32, height + 4, 0);
    this.shell.add(this.beacon);

    // A glass lift core on the camera-facing edge, with a car that rides to
    // whichever storey is in focus (and idles up and down when none is).
    const shaftX = TOWER_WIDTH / 2 + LIFT_WIDTH / 2 + 0.25;
    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(LIFT_WIDTH, height + 0.6, LIFT_DEPTH),
      new THREE.MeshStandardMaterial({
        color: 0x557267,
        emissive: 0x5c8a76,
        emissiveIntensity: 0.16,
        roughness: 0.28,
        metalness: 0.15,
        transparent: true,
        opacity: 0.55,
      })
    );
    shaft.position.set(shaftX, height / 2 - 0.3, FACADE_Z - LIFT_DEPTH / 2);
    this.shell.add(shaft);

    this.liftCar = new THREE.Mesh(
      new THREE.BoxGeometry(LIFT_WIDTH - 0.35, 2.1, LIFT_DEPTH - 0.4),
      new THREE.MeshStandardMaterial({
        color: 0x2f6b5a,
        emissive: 0x4c9a80,
        emissiveIntensity: 0.32,
        roughness: 0.38,
        metalness: 0.18,
      })
    );
    this.liftCar.position.set(shaftX, this.liftY, FACADE_Z - LIFT_DEPTH / 2);
    this.shell.add(this.liftCar);

    this.sun.target.position.set(0, height / 2, 0);
    this.sun.target.updateMatrixWorld();
    this.sun.position.set(14, height + 26, 26);
  }

  // ------------------------------------------------------------------ cells

  private buildFloorCells(floor: OfficeFloor, offices: TowerOffice[]) {
    if (!offices.length) return;

    const maxPerRow =
      floor.kind === "general" ? CHANNEL_PER_ROW : PERSONAL_PER_ROW;
    const counts = rowCounts(offices.length, maxPerRow);
    const rows = counts.length;
    const usableW = TOWER_WIDTH - INNER_PAD_X * 2;
    const usableH = FLOOR_HEIGHT - INNER_PAD_Y * 2;
    const rowH = usableH / rows;
    const baseY = floorY(this.floors, floor.index) + SLAB + INNER_PAD_Y;

    let index = 0;
    counts.forEach((count, row) => {
      const cellW = usableW / count;
      for (let col = 0; col < count; col += 1) {
        const office = offices[index];
        index += 1;
        if (!office) continue;
        this.buildOfficeCell(office, {
          x: -usableW / 2 + cellW * (col + 0.5),
          y: baseY + rowH * (row + 0.5),
          w: cellW,
          h: rowH,
          row,
          col,
        });
      }
    });
  }

  private buildOfficeCell(office: TowerOffice, rect: CellRect) {
    const w = Math.max(0.34, rect.w - CELL_GAP);
    const h = Math.max(0.34, rect.h - CELL_GAP);
    const bottom = rect.y - h / 2 + 0.02;
    const top = rect.y + h / 2;
    const zBack = FACADE_Z - CELL_INSET;
    const zFront = FACADE_Z;
    const personal = office.kind === "personal";
    const shared = !personal;
    const present = personal ? Boolean(office.present) : true;
    const accent = new THREE.Color(
      office.tint || (personal ? "#c9ad86" : "#7fae95")
    );
    const seed = office.floorIndex * 41 + rect.col * 7 + rect.row * 13;
    const warmth = 0.92 + noise(seed) * 0.12;

    // Every room has a warm back wall. The private offices are tinted very
    // slightly by their owner's colour so a storey is not a wall of beige.
    const wallColor = new THREE.Color(shared ? PALETTE.wall : 0xf6efe3).lerp(
      accent,
      shared ? 0.02 : 0.045
    );
    const style = this.cellStyle(office, wallColor, warmth);
    const material = new THREE.MeshStandardMaterial({
      color: style.wallColor,
      emissive: style.wallEmissive,
      emissiveIntensity: style.wallIntensity,
      roughness: 0.94,
    });

    const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), material);
    back.position.set(rect.x, rect.y, zBack + 0.04);
    this.shell.add(back);

    const floorMat = new THREE.MeshStandardMaterial({
      color: style.floorColor,
      roughness: 0.82,
    });
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.07, CELL_INSET),
      floorMat
    );
    floor.position.set(rect.x, bottom + 0.035, zBack + CELL_INSET / 2);
    this.shell.add(floor);

    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.055, h, CELL_INSET),
        new THREE.MeshStandardMaterial({
          color: PALETTE.wallShade,
          roughness: 0.9,
        })
      );
      wall.position.set(
        rect.x + side * (w / 2 - 0.028),
        rect.y,
        zBack + CELL_INSET / 2
      );
      this.shell.add(wall);
    }

    // The ceiling panel is the light source that makes the room read as an
    // interior rather than a painted square. Its brightness dims when the
    // occupant is idle, away, or offline.
    const ceilingMat = new THREE.MeshStandardMaterial({
      color: style.ceilingColor,
      emissive: style.ceilingEmissive,
      emissiveIntensity: style.ceilingIntensity,
      roughness: 0.4,
    });
    const ceilingLight = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.2, w * 0.55), 0.035, 0.14),
      ceilingMat
    );
    ceilingLight.position.set(rect.x, top - 0.08, zFront - 0.32);
    this.shell.add(ceilingLight);

    if (w >= 0.55) {
      const rug = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.54, Math.min(0.55, h * 0.24)),
        new THREE.MeshStandardMaterial({
          color: accent,
          roughness: 0.95,
          transparent: true,
          opacity: shared ? 0.22 : 0.16,
        })
      );
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(rect.x, bottom + 0.085, zFront - 0.7);
      this.shell.add(rug);
    }

    // A desk and monitor. In a shared room this becomes a longer table, so a
    // channel reads as a place several people can sit.
    const deskW = Math.min(Math.max(0.48, w * (shared ? 0.55 : 0.42)), 1.5);
    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(deskW, 0.06, 0.35),
      new THREE.MeshStandardMaterial({
        color: PALETTE.desk,
        roughness: 0.72,
      })
    );
    desk.position.set(rect.x, bottom + 0.68, zFront - 0.6);
    this.shell.add(desk);

    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(Math.min(deskW * 0.34, 0.34), 0.19, 0.02),
      new THREE.MeshStandardMaterial({
        color: 0x253a3f,
        emissive: PALETTE.screen,
        emissiveIntensity: 0.5,
        roughness: 0.55,
      })
    );
    screen.position.set(rect.x, bottom + 0.85, zFront - 0.76);
    this.shell.add(screen);

    const chair = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.055, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x38423d, roughness: 0.8 })
    );
    chair.position.set(rect.x, bottom + 0.4, zFront - 0.28);
    this.shell.add(chair);

    if (w >= 0.9) {
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.09, 0.14, 8),
        new THREE.MeshStandardMaterial({ color: PALETTE.pot, roughness: 0.9 })
      );
      pot.position.set(rect.x - w * 0.36, bottom + 0.14, zFront - 0.35);
      this.shell.add(pot);

      const leafMat = new THREE.MeshStandardMaterial({
        color: PALETTE.leaf,
        roughness: 0.92,
      });
      for (let leaf = 0; leaf < 3; leaf += 1) {
        const foliage = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 8, 6),
          leafMat
        );
        foliage.scale.set(0.8, 1.25, 0.8);
        foliage.position.set(
          rect.x - w * 0.36 + (leaf - 1) * 0.055,
          bottom + 0.32 + leaf * 0.08,
          zFront - 0.35 + (leaf % 2 === 0 ? 0.03 : -0.03)
        );
        this.shell.add(foliage);
      }
    }

    // The same bookshelf the walk-in office has against its back wall.
    if (personal && w >= 0.9) {
      const shelfH = Math.min(h * 0.55, 0.95);
      const shelfX = rect.x + w * 0.33;
      const shelfZ = zBack + 0.16;
      const shelf = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, shelfH, 0.16),
        new THREE.MeshStandardMaterial({ color: PALETTE.desk, roughness: 0.8 })
      );
      shelf.position.set(shelfX, bottom + shelfH / 2, shelfZ);
      this.shell.add(shelf);
      const rows = [PALETTE.accent, PALETTE.pot, PALETTE.screen];
      rows.forEach((color, row) => {
        const books = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, shelfH * 0.2, 0.02),
          new THREE.MeshStandardMaterial({ color, roughness: 0.9 })
        );
        books.position.set(
          shelfX,
          bottom + shelfH * (0.2 + row * 0.29),
          shelfZ + 0.085
        );
        this.shell.add(books);
      });
    }

    const cell: OfficeCell = {
      office,
      mesh: back,
      material,
      rect,
      ceilingLight,
      ceilingMaterial: ceilingMat,
      floorMaterial: floorMat,
      baseWallColor: wallColor,
      warmth,
    };

    if (personal) {
      const label = office.occupantName ?? office.name;
      const self = Boolean(office.isSelf);
      const discSize = clamp(Math.min(w * 0.24, h * 0.24), 0.2, 0.54);
      const disc = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: office.avatarUrl
            ? portraitTexture(
                office.avatarUrl,
                label,
                office.tint ?? "#8aa99a",
                self
              )
            : avatarTexture(label, office.tint ?? "#8aa99a", present, self),
          transparent: true,
          depthWrite: false,
        })
      );
      disc.scale.set(discSize, discSize, 1);
      disc.position.set(rect.x + w * 0.28, rect.y + h * 0.13, zBack + 0.1);
      this.shell.add(disc);
      cell.avatar = disc;

      // The person themselves stands in the office only while they are in
      // it. This is the at-a-glance difference between an empty desk and a
      // colleague who is working.
      if (present && w >= 0.8) {
        const personH = clamp(h * 0.17, 0.3, 0.66);
        const bodyRadius = personH * 0.19;
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(
            bodyRadius * 0.8,
            bodyRadius,
            personH * 0.56,
            8
          ),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(office.tint ?? "#4f7b69"),
            roughness: 0.9,
          })
        );
        body.position.set(
          rect.x - w * 0.18,
          bottom + personH * 0.38,
          zFront - 0.48
        );
        this.shell.add(body);

        const head = new THREE.Mesh(
          new THREE.SphereGeometry(personH * 0.16, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0xd7ad8a, roughness: 0.95 })
        );
        head.position.set(
          rect.x - w * 0.18,
          bottom + personH * 0.75,
          zFront - 0.48
        );
        this.shell.add(head);
      }

      if (w >= 1.15) {
        const plateLabel = self ? `${label} · You` : label;
        const plate = plateSprite(plateLabel);
        const plateW = Math.min(w - 0.14, 0.55 + plateLabel.length * 0.052);
        plate.scale.set(plateW, Math.max(0.18, plateW * 0.17), 1);
        plate.position.set(
          rect.x - w / 2 + plateW / 2 + 0.07,
          bottom + 0.18,
          zFront + 0.06
        );
        this.shell.add(plate);
        cell.plate = plate;
      }

      const radius = clamp(w * 0.035, 0.045, 0.085);
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 14),
        new THREE.MeshBasicMaterial({
          color: present ? statusColor(office.status) : STATUS_COLORS.away,
        })
      );
      dot.position.set(
        rect.x + w / 2 - radius * 2,
        top - radius * 2,
        zFront + 0.03
      );
      this.shell.add(dot);
      cell.statusDot = dot;
    } else if (w >= 1.15) {
      const plate = plateSprite(office.name, "#e9f3ed");
      const plateW = Math.min(w - 0.18, 0.6 + office.name.length * 0.055);
      plate.scale.set(plateW, Math.max(0.2, plateW * 0.17), 1);
      plate.position.set(
        rect.x - w / 2 + plateW / 2 + 0.08,
        bottom + 0.2,
        zFront + 0.06
      );
      this.shell.add(plate);
      cell.plate = plate;
    }

    // The invisible pick plane sits in front of everything. It makes the whole
    // window clickable without changing how the room looks.
    const pick = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    pick.position.set(rect.x, rect.y, zFront + 0.02);
    pick.userData.towerRoomId = office.roomId;
    this.shell.add(pick);
    cell.mesh = pick;
    this.cellMeshes.push(pick);

    this.cells.set(office.roomId, cell);
  }

  // ------------------------------------------------------------------ state

  /** The office under the pointer, for hover and click. */
  pick(
    ndc: THREE.Vector2,
    camera: THREE.PerspectiveCamera
  ): TowerOffice | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(this.cellMeshes, false);
    const roomId = hits[0]?.object.userData.towerRoomId as string | undefined;
    return roomId ? (this.cells.get(roomId)?.office ?? null) : null;
  }

  setHovered(roomId: string | null) {
    if (this.hovered === roomId) return;
    this.hovered = roomId;
    for (const [id, cell] of this.cells) {
      if (id === roomId) {
        cell.material.emissiveIntensity = 1.05;
      } else {
        const style = this.cellStyle(
          cell.office,
          cell.baseWallColor,
          cell.warmth
        );
        cell.material.emissiveIntensity = style.wallIntensity;
      }
    }
  }

  private cellStyle(
    office: TowerOffice,
    baseWallColor: THREE.Color,
    warmth: number
  ) {
    if (!isTowerRoom(office)) {
      return {
        ceilingColor: 0xc4bcae,
        ceilingEmissive: 0xcca666,
        ceilingIntensity: 0.25,
        wallColor: baseWallColor.clone().multiplyScalar(0.88),
        wallEmissive: PALETTE.glow,
        wallIntensity: 0.05 * warmth,
        floorColor: 0xa27c5b,
      };
    }

    if (office.kind !== "personal") {
      // Shared spaces (Lounge, Reception, Meeting rooms) stay warmly lit
      return {
        ceilingColor: 0xfff4d8,
        ceilingEmissive: 0xffe1a4,
        ceilingIntensity: 1.6,
        wallColor: baseWallColor,
        wallEmissive: PALETTE.glow,
        wallIntensity: 0.22 * warmth,
        floorColor: 0xd8d0c2,
      };
    }

    if (!office.present || office.status === "away") {
      // Away or unoccupied personal office: faint ambient night level (~15-20%)
      // preserving architectural wall, floor and furniture geometry without black voids.
      return {
        ceilingColor: 0xc4bcae,
        ceilingEmissive: 0xcca666,
        ceilingIntensity: 0.25,
        wallColor: baseWallColor.clone().multiplyScalar(0.88),
        wallEmissive: PALETTE.glow,
        wallIntensity: 0.05 * warmth,
        floorColor: 0xa27c5b,
      };
    }

    if (office.status === "idle") {
      // Inactive / idle occupant (> 2 min no input): soft warm dim (~50-60%)
      return {
        ceilingColor: 0xe8dcbe,
        ceilingEmissive: 0xd4a055,
        ceilingIntensity: 0.85,
        wallColor: baseWallColor.clone().multiplyScalar(0.94),
        wallEmissive: PALETTE.glow,
        wallIntensity: 0.16 * warmth,
        floorColor: 0xad8561,
      };
    }

    // Active occupant (online, call, dnd): fully bright and warm
    return {
      ceilingColor: 0xfff4d8,
      ceilingEmissive: 0xffe1a4,
      ceilingIntensity: 1.6,
      wallColor: baseWallColor,
      wallEmissive: PALETTE.glow,
      wallIntensity: 0.3 * warmth,
      floorColor: PALETTE.wood,
    };
  }

  private baseIntensity(cell: OfficeCell): number {
    return this.cellStyle(cell.office, cell.baseWallColor, cell.warmth)
      .wallIntensity;
  }

  private ceilingIntensity(cell: OfficeCell): number {
    return this.cellStyle(cell.office, cell.baseWallColor, cell.warmth)
      .ceilingIntensity;
  }

  /** Make one office pulse, used when a search picks a person out. */
  pulse(roomId: string) {
    this.pulsed = roomId;
    this.pulsedUntil = performance.now() + 2600;
  }

  /** Tint the storey a search result sits on. */
  tintFloor(index: number | null) {
    this.tintedFloor = index;
    this.applyFloorTint();
  }

  private applyFloorTint() {
    for (const [floorIndex, slab] of this.floorSlabs) {
      const material = slab.material as THREE.MeshStandardMaterial;
      material.color.setHex(
        floorIndex === this.tintedFloor
          ? PALETTE.slabTint
          : floorIndex === 0
            ? 0x46574f
            : PALETTE.slab
      );
    }
  }

  /** Frame one storey until it is cleared. */
  focusFloor(index: number | null) {
    this.focusedFloor = index;
    this.focusedRoom = null;
    this.tintFloor(index);
  }

  /**
   * Frame one office. The camera pans to it as well as in, so a click on the
   * far left of a full storey still lands on the office that was clicked.
   */
  focusRoom(roomId: string | null) {
    const cell = roomId ? this.cells.get(roomId) : undefined;
    this.focusFloor(cell ? cell.office.floorIndex : null);
    this.focusedRoom = cell ? (roomId ?? null) : null;
  }

  get focusY(): number {
    if (this.focusedRoom) {
      const cell = this.cells.get(this.focusedRoom);
      if (cell) return cell.rect.y;
    }
    if (this.focusedFloor === null) return this.height / 2;
    return this.storeyCenter(this.focusedFloor);
  }

  /** Where the tower camera should sit horizontally, -1..1 of the facade. */
  get focusX(): number {
    const cell = this.focusedRoom
      ? this.cells.get(this.focusedRoom)
      : undefined;
    return cell ? cell.rect.x : 0;
  }

  /** True when the camera is holding a single office rather than a storey. */
  get roomIsFramed(): boolean {
    return Boolean(this.focusedRoom && this.cells.get(this.focusedRoom));
  }

  private storeyCenter(index: number): number {
    return floorY(this.floors, index) + SLAB + FLOOR_HEIGHT / 2;
  }

  update(elapsed: number) {
    const dt = Math.min(Math.max(elapsed - this.lastElapsed, 0), 0.1);
    this.lastElapsed = elapsed;

    const active = this.pulsed;
    if (active) {
      const cell = this.cells.get(active);
      if (cell && performance.now() < this.pulsedUntil) {
        cell.material.emissiveIntensity = 0.8 + Math.sin(elapsed * 7) * 0.45;
      } else {
        this.pulsed = null;
        if (cell) {
          cell.material.emissiveIntensity = this.baseIntensity(cell);
        }
      }
    }

    if (this.liftCar) {
      const target =
        this.focusedFloor !== null
          ? this.storeyCenter(this.focusedFloor)
          : this.idleLiftY(elapsed);
      this.liftTargetY = target;
      this.liftY += (this.liftTargetY - this.liftY) * Math.min(1, dt * 2.4);
      this.liftCar.position.y = this.liftY;
    }

    if (this.beacon) {
      const pulse = 1 + Math.sin(elapsed * 3.2) * 0.18;
      this.beacon.scale.setScalar(pulse);
    }
  }

  private idleLiftY(elapsed: number): number {
    if (!this.floors.length) return 0;
    const stop = Math.floor(elapsed / 4.5) % this.floors.length;
    return this.storeyCenter(this.floors[stop].index);
  }

  dispose() {
    this.clearShell();
    this.floors = [];
    this.structureKey = "";
    this.focusedFloor = null;
    this.focusedRoom = null;
    this.tintedFloor = null;
    this.liftCar = null;
    this.beacon = null;
    this.lastElapsed = 0;
  }

  private clearShell() {
    for (const child of [...this.shell.children]) {
      this.shell.remove(child);
      child.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as
          | THREE.Material
          | THREE.Material[]
          | undefined;
        if (Array.isArray(material)) {
          for (const item of material) {
            disposeMaterial(item);
          }
        } else if (material) {
          disposeMaterial(material);
        }
      });
    }
    this.cells.clear();
    this.cellMeshes.length = 0;
    this.floorSlabs.clear();
    this.hovered = null;
    this.pulsed = null;
    this.liftCar = null;
    this.beacon = null;
  }
}

function disposeMaterial(material: THREE.Material) {
  const mapped = material as THREE.MeshStandardMaterial;
  mapped.map?.dispose();
  material.dispose();
}

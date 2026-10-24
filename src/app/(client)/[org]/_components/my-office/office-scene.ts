import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/addons/renderers/CSS2DRenderer.js";
import {
  FURNITURE,
  buildAvatar,
  box,
  type AvatarRig,
  type AvatarStyle,
} from "./office-models";

/** Interior size of a personal office, in metres. */
export const ROOM_W = 12;
export const ROOM_D = 10;
const WALL_H = 3.6;

export type Rotation = 0 | 90 | 180 | 270;

/** A placed object. x and z are measured from the room's back-left corner. */
export interface PlacedItem {
  id: string;
  catalogId: string;
  x: number;
  z: number;
  rotation: Rotation;
}

export const THEMES = {
  oak: {
    label: "Oak",
    floor: ["#d9b98f", "#d3b287", "#dfc199", "#cfab7e"],
    wall: "#efe7dc",
  },
  walnut: {
    label: "Walnut",
    floor: ["#8a5d3b", "#7f5535", "#94653f", "#7a5133"],
    wall: "#e9e4f5",
  },
  ash: {
    label: "Ash",
    floor: ["#e9e2d6", "#e2dacb", "#efe9df", "#ddd4c3"],
    wall: "#dfeee8",
  },
  night: {
    label: "Night",
    floor: ["#4a4658", "#433f51", "#524d61", "#3e3a4b"],
    wall: "#2f2c3b",
  },
} as const;
export type Theme = keyof typeof THEMES;

/** A new office: your own desk and chair, and a few basics. */
export const STARTER: PlacedItem[] = [
  { id: "rug-1", catalogId: "rug", x: 7, z: 5.6, rotation: 0 },
  { id: "desk-1", catalogId: "desk_oak", x: 7, z: 4.4, rotation: 0 },
  { id: "chair-1", catalogId: "chair_ergo", x: 7, z: 5.6, rotation: 0 },
  { id: "plant-1", catalogId: "plant", x: 0.8, z: 0.8, rotation: 0 },
  { id: "lamp-1", catalogId: "lamp", x: 10.6, z: 0.8, rotation: 0 },
  { id: "shelf-1", catalogId: "shelf", x: 3.6, z: 0.5, rotation: 0 },
];

const clampX = (x: number) =>
  THREE.MathUtils.clamp(x, -ROOM_W / 2 + 0.5, ROOM_W / 2 - 0.5);
const clampZ = (z: number) =>
  THREE.MathUtils.clamp(z, -ROOM_D / 2 + 0.5, ROOM_D / 2 - 0.5);
const snap = (v: number) => Math.round(v * 4) / 4;
const toRad = (r: Rotation) => (r * Math.PI) / 180;
const toRotation = (rad: number) =>
  ((((Math.round(rad / (Math.PI / 2)) * 90) % 360) + 360) % 360) as Rotation;

function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function floorTexture(tones: readonly string[]) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const g = canvas.getContext("2d");
  if (g) {
    for (let row = 0; row < 8; row++) {
      let x = -((row * 97) % 256);
      while (x < 512) {
        const w = 180 + ((row * 31 + x) % 140);
        const tone =
          (((row + Math.floor(x / 50)) % tones.length) + tones.length) %
          tones.length;
        g.fillStyle = tones[tone];
        g.fillRect(x, row * 64, w, 64);
        g.fillStyle = "rgba(80,50,20,.08)";
        g.fillRect(x, row * 64, 1, 64);
        x += w;
      }
      g.fillStyle = "rgba(80,50,20,.18)";
      g.fillRect(0, row * 64, 512, 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(ROOM_W / 6, ROOM_D / 6);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

class Avatar {
  readonly root = new THREE.Group();
  private rig: AvatarRig;
  private bubbleEl = document.createElement("div");
  private bubbleTimer: ReturnType<typeof setTimeout> | undefined;
  target: THREE.Vector3 | null = null;
  seat: THREE.Object3D | null = null;
  private walkT = 0;
  private onArrive: (() => void) | null = null;

  constructor(
    scene: THREE.Scene,
    name: string,
    style: AvatarStyle,
    isMe: boolean
  ) {
    const body = new THREE.Group();
    this.root.add(body);
    this.rig = buildAvatar(body, style);

    const label = document.createElement("div");
    label.className = isMe
      ? "rounded-full bg-[#8b5cf6] px-2 py-0.5 text-[11px] font-bold text-white"
      : "rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-bold text-white";
    label.textContent = name;
    const labelObject = new CSS2DObject(label);
    labelObject.position.set(0, 2.4, 0);
    this.root.add(labelObject);

    this.bubbleEl.className =
      "mb-1 hidden max-w-[200px] rounded-xl bg-white px-2.5 py-1.5 text-[12px] leading-snug text-[#1d1b22] shadow-lg transition-opacity [overflow-wrap:anywhere]";
    const bubble = new CSS2DObject(this.bubbleEl);
    bubble.position.set(0, 2.75, 0);
    this.root.add(bubble);
    scene.add(this.root);
  }

  setStyle(style: AvatarStyle) {
    this.rig = buildAvatar(this.rig.body, style);
  }

  say(text: string) {
    this.bubbleEl.textContent =
      text.length > 140 ? `${text.slice(0, 137)}…` : text;
    this.bubbleEl.classList.remove("hidden");
    this.bubbleEl.style.opacity = "1";
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => {
      this.bubbleEl.style.opacity = "0";
      this.bubbleTimer = setTimeout(
        () => this.bubbleEl.classList.add("hidden"),
        400
      );
    }, 7000);
  }

  hush() {
    clearTimeout(this.bubbleTimer);
    this.bubbleEl.classList.add("hidden");
  }

  walkTo(x: number, z: number, onArrive: (() => void) | null = null) {
    this.seat = null;
    this.target = new THREE.Vector3(clampX(x), 0, clampZ(z));
    this.onArrive = onArrive;
  }

  /** Sits facing the way the seat faces; seat backs are on local +z. */
  sitOn(seat: THREE.Object3D) {
    this.target = null;
    this.seat = seat;
    this.root.position.set(seat.position.x, 0, seat.position.z);
    this.root.rotation.y = seat.rotation.y;
  }

  update(dt: number) {
    let moving = false;
    if (this.target) {
      const delta = this.target.clone().sub(this.root.position);
      delta.y = 0;
      const dist = delta.length();
      if (dist < 0.05) {
        this.target = null;
        const done = this.onArrive;
        this.onArrive = null;
        done?.();
      } else {
        delta.normalize();
        this.root.position.addScaledVector(delta, Math.min(dist, 4 * dt));
        const facing = Math.atan2(-delta.x, -delta.z);
        this.root.rotation.y = lerpAngle(
          this.root.rotation.y,
          facing,
          Math.min(1, dt * 12)
        );
        moving = true;
      }
    }
    const { legL, legR, armL, armR, body } = this.rig;
    if (this.seat) {
      legL.rotation.x = legR.rotation.x = Math.PI / 2;
      armL.rotation.x = armR.rotation.x = -0.5;
      body.position.y = -0.05;
      return;
    }
    this.walkT = moving ? this.walkT + dt * 10 : this.walkT * 0.85;
    const swing = moving ? Math.sin(this.walkT) * 0.6 : 0;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = -swing * 0.8;
    armR.rotation.x = swing * 0.8;
    body.position.y = moving ? Math.abs(Math.sin(this.walkT)) * 0.06 : 0;
  }

  dispose(scene: THREE.Scene) {
    clearTimeout(this.bubbleTimer);
    scene.remove(this.root);
    this.root.traverse((o) => {
      if (o instanceof CSS2DObject) o.element.remove();
    });
  }
}

export interface SceneEvents {
  /** The selected object changed while decorating. */
  onSelect(catalogId: string | null): void;
  /** Objects were added, moved, rotated or removed. */
  onLayoutChange(items: PlacedItem[]): void;
}

/**
 * The 3D personal office. Framework free: the React page drives it through
 * these methods and hears back through `SceneEvents`.
 */
export class PersonalOfficeScene {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private labels = new CSS2DRenderer();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  private controls: OrbitControls;
  private room = new THREE.Group();
  private furniture = new THREE.Group();
  private me: Avatar | null = null;
  private host: Avatar | null = null;
  private selected: THREE.Object3D | null = null;
  private dragging = false;
  private downAt: { x: number; y: number } | null = null;
  private dragOffset = new THREE.Vector3();
  private ray = new THREE.Raycaster();
  private keys = new Set<string>();
  private clock = new THREE.Clock();
  private sign: THREE.CanvasTexture | null = null;
  private inset = { left: 0, right: 0 };
  decorating = false;

  constructor(
    private container: HTMLElement,
    private events: SceneEvents
  ) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.labels.domElement.style.cssText =
      "position:absolute;inset:0;pointer-events:none";
    container.appendChild(this.labels.domElement);

    this.camera.position.set(10, 12, 14);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.42;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 30;
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };

    this.scene.add(new THREE.HemisphereLight("#ffffff", "#d9cfc2", 1.1));
    const sun = new THREE.DirectionalLight("#fff4e6", 1.6);
    sun.position.set(8, 16, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -10,
      right: 10,
      top: 10,
      bottom: -10,
    });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun, this.room, this.furniture);

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.resize);
    this.resize();
    this.renderer.setAnimationLoop(this.tick);
  }

  /* ---------- Room and objects ---------- */

  buildRoom(theme: Theme, ownerName: string) {
    while (this.room.children.length) this.room.remove(this.room.children[0]);
    const t = THEMES[theme] ?? THEMES.oak;
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(ROOM_W, 0.3, ROOM_D),
      new THREE.MeshStandardMaterial({
        map: floorTexture(t.floor),
        roughness: 0.85,
      })
    );
    floor.position.y = -0.15;
    floor.receiveShadow = true;
    const base = box(ROOM_W + 0.6, 0.5, ROOM_D + 0.6, "#3a3550", 0, -0.55, 0);
    base.castShadow = false;
    this.room.add(
      floor,
      base,
      box(ROOM_W, WALL_H, 0.3, t.wall, 0, WALL_H / 2, -ROOM_D / 2 - 0.15),
      box(0.3, WALL_H, ROOM_D, t.wall, -ROOM_W / 2 - 0.15, WALL_H / 2, 0),
      box(0.1, 2.5, 1.4, "#9b7653", -ROOM_W / 2 + 0.02, 1.25, 3),
      box(0.12, 0.08, 0.08, "#d9c27a", -ROOM_W / 2 + 0.1, 1.2, 2.5)
    );
    for (const x of [-3, 3]) {
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(2.6, 1.5),
        new THREE.MeshStandardMaterial({
          color: "#bfe3ff",
          emissive: "#bfe3ff",
          emissiveIntensity: 0.35,
        })
      );
      glass.position.set(x, 2.2, -ROOM_D / 2 + 0.09);
      this.room.add(
        box(2.9, 1.8, 0.12, "#ffffff", x, 2.2, -ROOM_D / 2 + 0.02),
        glass
      );
    }

    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 160;
    const g = canvas.getContext("2d");
    if (g) {
      g.fillStyle = "#8b5cf6";
      g.beginPath();
      g.roundRect(0, 0, 640, 160, 32);
      g.fill();
      g.fillStyle = "#fff";
      g.font = "700 60px Inter, system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      let name = ownerName;
      while (g.measureText(`${name}'s office`).width > 580 && name.length > 3)
        name = name.slice(0, -1);
      g.fillText(`${name === ownerName ? name : `${name}…`}'s office`, 320, 84);
    }
    this.sign?.dispose();
    this.sign = new THREE.CanvasTexture(canvas);
    this.sign.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 0.9),
      new THREE.MeshStandardMaterial({ map: this.sign, transparent: true })
    );
    sign.position.set(-ROOM_W / 2 + 0.02, 2.75, -1.2);
    sign.rotation.y = Math.PI / 2;
    this.room.add(sign);
  }

  setLayout(items: PlacedItem[]) {
    this.select(null);
    while (this.furniture.children.length)
      this.furniture.remove(this.furniture.children[0]);
    items.forEach((item) => this.place(item));
  }

  getLayout(): PlacedItem[] {
    return this.furniture.children.map((g) => ({
      id: g.userData.id as string,
      catalogId: g.userData.catalogId as string,
      x: +(g.position.x + ROOM_W / 2).toFixed(2),
      z: +(g.position.z + ROOM_D / 2).toFixed(2),
      rotation: toRotation(g.rotation.y),
    }));
  }

  private place(item: PlacedItem) {
    const def = FURNITURE[item.catalogId];
    if (!def) return null;
    const g = def.build();
    g.traverse((o) => {
      o.userData.root = g;
    });
    g.userData = { id: item.id, catalogId: item.catalogId };
    g.position.set(clampX(item.x - ROOM_W / 2), 0, item.z - ROOM_D / 2);
    if (def.wall) g.position.z = -ROOM_D / 2 + 0.08;
    g.rotation.y = toRad(item.rotation);
    this.furniture.add(g);
    return g;
  }

  /** Adds an object in the emptiest spot so it doesn't land on the desk. */
  addItem(catalogId: string) {
    const def = FURNITURE[catalogId];
    if (!def) return;
    let spot = { x: 0, z: 2 };
    if (def.wall) {
      const count = this.furniture.children.filter(
        (g) => g.userData.catalogId === catalogId
      ).length;
      spot = { x: [0, -5, 5, -1.5, 1.5][count % 5], z: -ROOM_D / 2 };
    } else {
      const taken = this.furniture.children
        .filter(
          (g) =>
            g.userData.catalogId !== "rug" &&
            !FURNITURE[g.userData.catalogId]?.wall
        )
        .map((g) => g.position);
      // Enough room around it first, then as close to the middle as possible.
      let best = -Infinity;
      for (let x = -ROOM_W / 2 + 1.5; x <= ROOM_W / 2 - 1.5; x += 1) {
        for (let z = -ROOM_D / 2 + 1.5; z <= ROOM_D / 2 - 1.5; z += 1) {
          const gap = Math.min(
            2.5,
            ...taken.map((p) => Math.hypot(p.x - x, p.z - z))
          );
          const score = gap * 10 - Math.hypot(x, z);
          if (score > best) {
            best = score;
            spot = { x, z };
          }
        }
      }
    }
    const id = `${catalogId}-${Date.now().toString(36)}`;
    const g = this.place({
      id,
      catalogId,
      x: spot.x + ROOM_W / 2,
      z: spot.z + ROOM_D / 2,
      rotation: 0,
    });
    this.changed();
    if (g) this.select(g);
  }

  rotateSelected() {
    if (!this.selected) return;
    this.selected.rotation.y += Math.PI / 2;
    if (this.me?.seat === this.selected) this.me.sitOn(this.selected);
    this.changed();
  }

  duplicateSelected() {
    const s = this.selected;
    if (!s) return;
    const g = this.place({
      id: `${s.userData.catalogId}-${Date.now().toString(36)}`,
      catalogId: s.userData.catalogId,
      x: clampX(s.position.x + 1) + ROOM_W / 2,
      z: clampZ(s.position.z + 1) + ROOM_D / 2,
      rotation: toRotation(s.rotation.y),
    });
    this.changed();
    if (g) this.select(g);
  }

  removeSelected() {
    const s = this.selected;
    if (!s) return;
    if (this.me?.seat === s) this.me.seat = null;
    this.select(null);
    this.furniture.remove(s);
    this.changed();
  }

  private changed() {
    this.events.onLayoutChange(this.getLayout());
  }

  select(g: THREE.Object3D | null) {
    const tint = (obj: THREE.Object3D | null, on: boolean) =>
      obj?.traverse((o) => {
        if (
          !(o instanceof THREE.Mesh) ||
          !(o.material instanceof THREE.MeshStandardMaterial)
        )
          return;
        if (on) {
          o.userData.original = o.material;
          o.material = o.material.clone();
          o.material.emissive.set("#8b5cf6");
          o.material.emissiveIntensity = 0.35;
        } else if (o.userData.original) {
          o.material.dispose();
          o.material = o.userData.original;
          delete o.userData.original;
        }
      });
    tint(this.selected, false);
    this.selected = g;
    tint(g, true);
    this.events.onSelect(g ? (g.userData.catalogId as string) : null);
  }

  /* ---------- People ---------- */

  setMe(name: string, style: AvatarStyle) {
    this.me?.dispose(this.scene);
    this.me = new Avatar(this.scene, name, style, true);
  }

  setMyStyle(style: AvatarStyle) {
    this.me?.setStyle(style);
  }

  setHost(name: string | null, style?: AvatarStyle) {
    this.host?.dispose(this.scene);
    this.host =
      name && style ? new Avatar(this.scene, name, style, false) : null;
    if (this.host) {
      const chair = this.firstSeat();
      if (chair) this.host.sitOn(chair);
    }
  }

  say(who: "me" | "host", text: string) {
    (who === "me" ? this.me : this.host)?.say(text);
  }

  private firstSeat() {
    return (
      this.furniture.children.find(
        (g) => g.userData.catalogId === "chair_ergo"
      ) ?? null
    );
  }

  /** At home: sit at your own desk. */
  sitAtDesk() {
    if (!this.me) return;
    this.me.hush();
    const chair = this.firstSeat();
    if (chair) this.me.sitOn(chair);
    else this.me.root.position.set(0, 0, 2);
  }

  /** Visiting: come in through the door and walk up to the owner. */
  walkInAsGuest() {
    const me = this.me;
    if (!me) return;
    me.hush();
    me.seat = null;
    me.root.position.set(-ROOM_W / 2 + 0.8, 0, 3);
    me.root.rotation.y = -Math.PI / 2;
    const host = this.host?.root.position ?? new THREE.Vector3();
    me.walkTo(host.x - 1.1, host.z + 1.3, () => {
      const p = me.root.position;
      me.root.rotation.y = Math.atan2(-(host.x - p.x), -(host.z - p.z));
    });
  }

  /* ---------- Input ---------- */

  private pointerRay(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
    this.ray.setFromCamera(ndc, this.camera);
  }

  private groundAt(e: PointerEvent) {
    this.pointerRay(e);
    const hit = new THREE.Vector3();
    return this.ray.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      hit
    )
      ? hit
      : null;
  }

  private objectAt(e: PointerEvent): THREE.Object3D | null {
    this.pointerRay(e);
    const hit = this.ray.intersectObjects(this.furniture.children, true)[0];
    return (hit?.object.userData.root as THREE.Object3D) ?? null;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.downAt = { x: e.clientX, y: e.clientY };
    if (!this.decorating) return;
    const target = this.objectAt(e);
    this.select(target);
    if (!target) return;
    this.dragging = true;
    const p = this.groundAt(e);
    if (p) this.dragOffset.copy(target.position).sub(p);
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging || !this.selected) return;
    const p = this.groundAt(e);
    if (!p) return;
    this.selected.position.x = clampX(snap(p.x + this.dragOffset.x));
    if (!FURNITURE[this.selected.userData.catalogId]?.wall) {
      this.selected.position.z = clampZ(snap(p.z + this.dragOffset.z));
    }
    if (this.me?.seat === this.selected) this.me.sitOn(this.selected);
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.dragging) {
      this.dragging = false;
      this.changed();
      return;
    }
    const start = this.downAt;
    this.downAt = null;
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6)
      return;
    if (this.decorating || !this.me) return;
    const me = this.me;
    const target = this.objectAt(e);
    if (
      target &&
      FURNITURE[target.userData.catalogId]?.seat &&
      this.host?.seat !== target
    ) {
      const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        target.rotation.y
      );
      me.walkTo(
        target.position.x - forward.x * 0.9,
        target.position.z - forward.z * 0.9,
        () => me.sitOn(target)
      );
      return;
    }
    const p = this.groundAt(e);
    if (p) me.walkTo(p.x, p.z);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
    this.keys.add(e.key.toLowerCase());
    if (!this.decorating) return;
    if (e.key === "r" || e.key === "R") this.rotateSelected();
    if (e.key === "Delete" || e.key === "Backspace") this.removeSelected();
    if (e.key === "Escape") this.select(null);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private keyWalk() {
    if (!this.me || this.decorating) return;
    const k = this.keys;
    const f =
      (k.has("w") || k.has("arrowup") ? 1 : 0) -
      (k.has("s") || k.has("arrowdown") ? 1 : 0);
    const s =
      (k.has("d") || k.has("arrowright") ? 1 : 0) -
      (k.has("a") || k.has("arrowleft") ? 1 : 0);
    if (!f && !s) return;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(
      forward,
      new THREE.Vector3(0, 1, 0)
    );
    const dir = forward
      .multiplyScalar(f)
      .add(right.multiplyScalar(s))
      .normalize();
    const p = this.me.root.position;
    this.me.walkTo(p.x + dir.x * 0.6, p.z + dir.z * 0.6);
  }

  /* ---------- Frame loop ---------- */

  /** Keeps the room centred between the side panel and the chat panel. */
  setInsets(left: number, right: number) {
    this.inset = { left, right };
    this.resize();
  }

  resize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    const shift = w > 820 ? this.inset.right - this.inset.left : 0;
    if (shift > 0) this.camera.setViewOffset(w + shift, h, shift, 0, w, h);
    else if (shift < 0) this.camera.setViewOffset(w - shift, h, 0, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  };

  private tick = () => {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.keyWalk();
    this.me?.update(dt);
    this.host?.update(dt);
    if (this.me && !this.decorating) {
      const follow = this.me.root.position
        .clone()
        .multiplyScalar(0.4)
        .setY(0.6);
      this.controls.target.lerp(follow, Math.min(1, dt * 2));
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };

  dispose() {
    this.renderer.setAnimationLoop(null);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.resize);
    this.me?.dispose(this.scene);
    this.host?.dispose(this.scene);
    this.controls.dispose();
    this.renderer.dispose();
    canvas.remove();
    this.labels.domElement.remove();
  }
}

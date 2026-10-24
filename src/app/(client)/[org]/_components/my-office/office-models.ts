import * as THREE from "three";

/**
 * Low-poly models for the personal office: the furniture a person can place
 * and the avatar they can style. Everything is built from boxes so it stays
 * light and matches the look of the shared office.
 */

export type HairStyle = "short" | "long" | "bun" | "spiky" | "bald";
export type Accessory = "none" | "headphones" | "glasses" | "cap";
export type Outfit = "casual" | "smart" | "hoodie" | "lab";
export type Body = "a" | "b" | "c";

/**
 * The full look. `tint`, `body`, `outfit` and `accessory` match the office
 * API's avatar (PUT /users/me/avatar) so the same person looks the same in the
 * shared building. The rest is extra detail kept for the personal office.
 */
export interface AvatarStyle {
  tint: string;
  body: Body;
  outfit: Outfit;
  accessory: Accessory;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  bottom: string;
}

export const DEFAULT_STYLE: AvatarStyle = {
  tint: "#8b5cf6",
  body: "b",
  outfit: "casual",
  accessory: "none",
  skin: "#eac09f",
  hair: "#1f1a17",
  hairStyle: "short",
  bottom: "#2b2d42",
};

export const HAIR_STYLES: Record<HairStyle, string> = {
  short: "Short",
  long: "Long",
  bun: "Bun",
  spiky: "Spiky",
  bald: "None",
};
export const ACCESSORIES: Record<Accessory, string> = {
  none: "None",
  glasses: "Glasses",
  headphones: "Headphones",
  cap: "Cap",
};
export const OUTFITS: Record<Outfit, string> = {
  casual: "Casual",
  smart: "Smart",
  hoodie: "Hoodie",
  lab: "Lab coat",
};
export const BODIES: Record<Body, string> = {
  a: "Slim",
  b: "Regular",
  c: "Broad",
};
export const PALETTES = {
  skin: ["#f6d7c3", "#eac09f", "#d39c76", "#a86b47", "#7a4a2e", "#4e2f1e"],
  hair: ["#1f1a17", "#5a3825", "#a5663a", "#e3c16f", "#c94f3d", "#7d5fff"],
  tint: ["#8b5cf6", "#e63946", "#2a9d8f", "#f4a261", "#264653", "#ff7ab6"],
  bottom: ["#2b2d42", "#3a5a80", "#6b705c", "#8d6e63", "#111111", "#d4c5a9"],
};

export function hashString(value: string) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A stable look for someone whose avatar we can't load. */
export function styleFor(seed: string): AvatarStyle {
  const hash = hashString(seed);
  const pick = <T>(list: readonly T[], shift: number) =>
    list[(hash >>> shift) % list.length];
  return {
    skin: pick(PALETTES.skin, 1),
    hair: pick(PALETTES.hair, 5),
    tint: pick(PALETTES.tint, 9),
    bottom: pick(PALETTES.bottom, 13),
    hairStyle: pick(Object.keys(HAIR_STYLES) as HairStyle[], 17),
    accessory: pick(Object.keys(ACCESSORIES) as Accessory[], 21),
    outfit: pick(Object.keys(OUTFITS) as Outfit[], 25),
    body: pick(Object.keys(BODIES) as Body[], 29),
  };
}

const material = (
  color: string,
  extra: THREE.MeshStandardMaterialParameters = {}
) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: 0.8,
    metalness: 0.05,
    ...extra,
  });

export function box(
  w: number,
  h: number,
  d: number,
  color: string,
  x = 0,
  y = 0,
  z = 0
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function shape(geometry: THREE.BufferGeometry, color: string, extra = {}) {
  const mesh = new THREE.Mesh(geometry, material(color, extra));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Furniture. Ids follow the shared office catalogue where one exists. */
/* ------------------------------------------------------------------ */

const WOOD = "#b98a5e";
const DARK = "#3b3842";
const METAL = "#9aa0a6";

export interface FurnitureDef {
  label: string;
  /** People can sit on it. The back of every seat faces local +z. */
  seat?: boolean;
  /** Hangs on the back wall instead of standing on the floor. */
  wall?: boolean;
  build(): THREE.Group;
}

const group = (...children: THREE.Object3D[]) => {
  const g = new THREE.Group();
  children.forEach((child) => g.add(child));
  return g;
};

export const FURNITURE: Record<string, FurnitureDef> = {
  desk_oak: {
    label: "Desk",
    build() {
      const screen = shape(new THREE.PlaneGeometry(0.82, 0.47), "#6f7cff", {
        emissive: "#6f7cff",
        emissiveIntensity: 0.5,
      });
      screen.position.set(0, 1.45, -0.32);
      return group(
        box(2.4, 0.1, 1.2, WOOD, 0, 1.05, 0),
        ...[-1.1, 1.1].flatMap((x) =>
          [-0.5, 0.5].map((z) => box(0.08, 1, 0.08, DARK, x, 0.5, z))
        ),
        box(0.9, 0.55, 0.05, "#222", 0, 1.45, -0.35),
        screen,
        box(0.08, 0.3, 0.08, "#222", 0, 1.2, -0.38),
        box(0.6, 0.03, 0.2, "#ddd", 0, 1.115, 0.1),
        box(0.12, 0.14, 0.12, "#e76f51", 0.8, 1.17, 0.1)
      );
    },
  },
  chair_ergo: {
    label: "Chair",
    seat: true,
    build: () =>
      group(
        box(0.7, 0.12, 0.7, "#4d5bd6", 0, 0.6, 0),
        box(0.7, 0.75, 0.1, "#4d5bd6", 0, 1.0, 0.32),
        box(0.08, 0.55, 0.08, METAL, 0, 0.3, 0),
        box(0.6, 0.05, 0.6, DARK, 0, 0.03, 0)
      ),
  },
  sofa: {
    label: "Sofa",
    seat: true,
    build: () =>
      group(
        box(2.8, 0.45, 1.1, "#e07a5f", 0, 0.35, 0),
        box(2.8, 0.8, 0.25, "#e07a5f", 0, 0.8, 0.43),
        box(0.25, 0.65, 1.1, "#e07a5f", -1.28, 0.6, 0),
        box(0.25, 0.65, 1.1, "#e07a5f", 1.28, 0.6, 0),
        box(1.1, 0.15, 0.8, "#f2a48d", -0.6, 0.63, -0.05),
        box(1.1, 0.15, 0.8, "#f2a48d", 0.6, 0.63, -0.05)
      ),
  },
  beanbag: {
    label: "Bean bag",
    seat: true,
    build() {
      const bag = shape(new THREE.SphereGeometry(0.55, 14, 10), "#f4a261");
      bag.scale.set(1, 0.6, 1);
      bag.position.y = 0.33;
      return group(bag, box(0.8, 0.5, 0.25, "#f4a261", 0, 0.65, 0.3));
    },
  },
  coffee_table: {
    label: "Coffee table",
    build: () =>
      group(
        box(1.6, 0.08, 0.9, WOOD, 0, 0.5, 0),
        ...[-0.7, 0.7].flatMap((x) =>
          [-0.35, 0.35].map((z) => box(0.07, 0.46, 0.07, DARK, x, 0.23, z))
        ),
        box(0.3, 0.06, 0.4, "#8b5cf6", 0.3, 0.57, 0)
      ),
  },
  plant: {
    label: "Plant",
    build() {
      const pot = shape(
        new THREE.CylinderGeometry(0.32, 0.25, 0.6, 16),
        "#e9d8c4"
      );
      pot.position.y = 0.3;
      const leaves = [
        [0, 1.05, 0, 0.42],
        [0.2, 1.35, 0.1, 0.3],
        [-0.18, 1.3, -0.1, 0.28],
        [0, 1.6, 0, 0.24],
      ].map(([x, y, z, r]) => {
        const leaf = shape(new THREE.IcosahedronGeometry(r, 0), "#4f9d69", {
          flatShading: true,
        });
        leaf.position.set(x, y, z);
        return leaf;
      });
      return group(pot, ...leaves);
    },
  },
  shelf: {
    label: "Bookshelf",
    build() {
      const g = group(
        box(1.8, 2.4, 0.08, WOOD, 0, 1.2, -0.21),
        box(0.08, 2.4, 0.5, WOOD, -0.86, 1.2, 0),
        box(0.08, 2.4, 0.5, WOOD, 0.86, 1.2, 0)
      );
      const colors = ["#e63946", "#457b9d", "#f4a261", "#2a9d8f", "#8338ec"];
      for (let s = 0; s < 4; s++) {
        g.add(box(1.7, 0.06, 0.5, WOOD, 0, 0.05 + s * 0.6, 0));
        for (let i = 0, x = -0.75; x < 0.65; i++) {
          const w = 0.1 + ((s * 3 + i) % 3) * 0.03;
          const h = 0.34 + ((s + i) % 3) * 0.05;
          g.add(
            box(
              w,
              h,
              0.32,
              colors[(s + i) % 5],
              x + w / 2,
              0.08 + s * 0.6 + h / 2,
              0
            )
          );
          x += w + 0.02;
        }
      }
      return g;
    },
  },
  lamp: {
    label: "Lamp",
    build() {
      const lampshade = shape(
        new THREE.CylinderGeometry(0.2, 0.38, 0.45, 20, 1, true),
        "#fff2cc",
        { emissive: "#ffe08a", emissiveIntensity: 0.6, side: THREE.DoubleSide }
      );
      lampshade.position.y = 2.05;
      const light = new THREE.PointLight("#ffd27a", 4, 6, 1.5);
      light.position.y = 1.9;
      return group(
        box(0.45, 0.05, 0.45, DARK, 0, 0.03, 0),
        box(0.05, 1.9, 0.05, DARK, 0, 0.98, 0),
        lampshade,
        light
      );
    },
  },
  rug: {
    label: "Rug",
    build() {
      const outer = box(3, 0.03, 2, "#8d7bd6", 0, 0.015, 0);
      const inner = box(2.5, 0.035, 1.5, "#b3a6ea", 0, 0.02, 0);
      outer.castShadow = inner.castShadow = false;
      return group(outer, inner);
    },
  },
  whiteboard: {
    label: "Whiteboard",
    build() {
      const g = group(
        box(2.2, 1.3, 0.06, "#fafafa", 0, 1.6, 0),
        box(2.3, 0.06, 0.15, METAL, 0, 0.93, 0.03)
      );
      for (const x of [-1, 1]) {
        g.add(box(0.06, 1.95, 0.06, METAL, x, 0.97, 0));
        g.add(box(0.06, 0.04, 0.5, METAL, x, 0.02, 0));
      }
      const notes: Array<[number, number, string]> = [
        [-0.6, 1.9, "#ffd166"],
        [-0.2, 1.75, "#06d6a0"],
        [0.3, 1.95, "#ef476f"],
        [0.65, 1.6, "#118ab2"],
      ];
      notes.forEach(([x, y, c]) => g.add(box(0.28, 0.28, 0.02, c, x, y, 0.04)));
      return g;
    },
  },
  coffee_bar: {
    label: "Coffee bar",
    build: () =>
      group(
        box(1.6, 1, 0.7, "#3d405b", 0, 0.5, 0),
        box(1.7, 0.06, 0.8, "#f4f1de", 0, 1.03, 0),
        box(0.45, 0.55, 0.4, "#c0c0c0", -0.35, 1.33, 0),
        ...[0.25, 0.45, 0.65].map((x) =>
          box(0.1, 0.13, 0.1, "#fff", x, 1.12, 0.1)
        )
      ),
  },
  wall_art: {
    label: "Wall art",
    wall: true,
    build() {
      const sun = shape(new THREE.CircleGeometry(0.16, 20), "#ff6b6b");
      sun.position.set(0.25, 2.45, 0.045);
      return group(
        box(1.4, 1, 0.06, "#2b2d42", 0, 2.3, 0),
        box(1.2, 0.8, 0.02, "#ffd6a5", 0, 2.3, 0.03),
        sun,
        box(1.2, 0.22, 0.02, "#4f9d69", 0, 2.0, 0.04)
      );
    },
  },
};

/* ---------------- Avatar ---------------- */

export interface AvatarRig {
  body: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
}

/** Builds a blocky person into `body` and returns the moving parts. */
export function buildAvatar(body: THREE.Group, s: AvatarStyle): AvatarRig {
  while (body.children.length) body.remove(body.children[0]);
  const width = { a: 0.52, b: 0.62, c: 0.74 }[s.body] ?? 0.62;
  const top = s.outfit === "lab" ? "#f4f4f6" : s.tint;

  const leg = (x: number) => {
    const mesh = box(0.22, 0.75, 0.24, s.bottom, x, 0, 0);
    mesh.geometry.translate(0, -0.375, 0);
    mesh.position.y = 0.75;
    body.add(mesh);
    return mesh;
  };
  const legL = leg(-0.14);
  const legR = leg(0.14);

  body.add(box(width, 0.72, 0.36, top, 0, 1.12, 0));
  if (s.outfit === "lab")
    body.add(box(width + 0.04, 0.4, 0.38, top, 0, 0.66, 0));
  if (s.outfit === "lab" || s.outfit === "smart") {
    body.add(
      box(
        0.12,
        0.5,
        0.02,
        s.outfit === "lab" ? s.tint : "#1d1b22",
        0,
        1.18,
        -0.19
      )
    );
  }
  if (s.outfit === "smart")
    body.add(box(width * 0.6, 0.08, 0.38, "#ffffff", 0, 1.46, 0));
  if (s.outfit === "hoodie")
    body.add(box(0.46, 0.34, 0.14, s.tint, 0, 1.55, 0.24));

  const arm = (x: number) => {
    const mesh = box(0.16, 0.62, 0.18, top, x, 0, 0);
    mesh.geometry.translate(0, -0.27, 0);
    mesh.position.y = 1.44;
    mesh.add(box(0.15, 0.13, 0.17, s.skin, 0, -0.62, 0));
    body.add(mesh);
    return mesh;
  };
  const armL = arm(-(width / 2 + 0.09));
  const armR = arm(width / 2 + 0.09);

  body.add(box(0.18, 0.1, 0.18, s.skin, 0, 1.53, 0));
  body.add(box(0.5, 0.5, 0.48, s.skin, 0, 1.82, 0));
  for (const x of [-0.11, 0.11])
    body.add(box(0.07, 0.09, 0.02, "#1d1b22", x, 1.85, -0.245));
  body.add(box(0.14, 0.03, 0.02, "#8a3b3b", 0, 1.71, -0.245));

  const h = s.hair;
  if (s.hairStyle === "short") {
    body.add(
      box(0.54, 0.16, 0.52, h, 0, 2.1, 0.01),
      box(0.54, 0.3, 0.12, h, 0, 1.95, 0.21)
    );
  } else if (s.hairStyle === "long") {
    body.add(
      box(0.56, 0.16, 0.54, h, 0, 2.1, 0.01),
      box(0.58, 0.7, 0.16, h, 0, 1.7, 0.2),
      box(0.1, 0.55, 0.45, h, -0.28, 1.78, 0.03),
      box(0.1, 0.55, 0.45, h, 0.28, 1.78, 0.03)
    );
  } else if (s.hairStyle === "bun") {
    const bun = shape(new THREE.SphereGeometry(0.16, 12, 10), h);
    bun.position.set(0, 2.25, 0.15);
    body.add(box(0.54, 0.14, 0.52, h, 0, 2.1, 0.01), bun);
  } else if (s.hairStyle === "spiky") {
    for (let i = 0; i < 5; i++) {
      const spike = shape(new THREE.ConeGeometry(0.1, 0.28, 5), h, {
        flatShading: true,
      });
      spike.position.set(-0.2 + i * 0.1, 2.18, (i % 2) * 0.1);
      spike.rotation.z = (i - 2) * 0.2;
      body.add(spike);
    }
    body.add(box(0.54, 0.1, 0.52, h, 0, 2.08, 0.01));
  }

  if (s.accessory === "glasses") {
    body.add(
      box(0.16, 0.12, 0.02, "#111", -0.11, 1.86, -0.26),
      box(0.16, 0.12, 0.02, "#111", 0.11, 1.86, -0.26),
      box(0.06, 0.02, 0.02, "#111", 0, 1.88, -0.26)
    );
  } else if (s.accessory === "headphones") {
    body.add(
      box(0.6, 0.06, 0.12, "#222", 0, 2.17, 0),
      box(0.08, 0.2, 0.18, "#e63946", -0.29, 1.85, 0),
      box(0.08, 0.2, 0.18, "#e63946", 0.29, 1.85, 0)
    );
  } else if (s.accessory === "cap") {
    body.add(
      box(0.56, 0.18, 0.54, s.tint, 0, 2.12, 0.01),
      box(0.5, 0.04, 0.3, s.tint, 0, 2.05, -0.36)
    );
  }
  return { body, legL, legR, armL, armR };
}

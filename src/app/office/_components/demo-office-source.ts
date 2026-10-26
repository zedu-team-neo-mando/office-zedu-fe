"use client";

import {
  CHAT_SEEDS,
  DEFAULT_AVATAR,
  DEMO_LAYOUTS,
  DEMO_USERS,
  ROOMS,
  zoeAnswer,
  type FurnitureItem,
} from "./office-data";
import type {
  OfficeAvatarConfig,
  OfficeChatMessage,
  OfficeFloor,
  OfficeFurnitureItem,
  OfficeOccupant,
  OfficePresenceStatus,
  OfficeRoom,
  OfficeSource,
  OfficeZoeContext,
} from "~/types/office";
import type { TowerOffice } from "./engine/tower-scene";
import { uiAvatarUrl } from "~/lib/env-urls";

const KEY_LAYOUTS = "office-demo-layouts-v2";
const KEY_AVATAR = "office-demo-avatar-v1";

/**
 * The demo is the full building, not a sample of it: ten storeys, and every
 * member floor filled to the same forty-office capacity the live API uses.
 * The three rooms the demo can be walked through keep their real ids; the
 * rest is the directory that makes the tower look and search like a company.
 */
const DEMO_STOREYS = 9;
const DEMO_CAPACITY = 40;

const DEMO_FIRST_NAMES = [
  "Ngozi",
  "Emeka",
  "Fatima",
  "Chidi",
  "Amara",
  "Tobi",
  "Zainab",
  "Kelechi",
  "Ifeoma",
  "Damilola",
  "Bisi",
  "Yusuf",
  "Aisha",
  "Nnamdi",
  "Sade",
  "Bayo",
  "Chioma",
  "Ibrahim",
  "Temi",
  "Obi",
];

const DEMO_LAST_NAMES = [
  "Adeyemi",
  "Okafor",
  "Bello",
  "Eze",
  "Lawal",
  "Mensah",
  "Nwosu",
  "Balogun",
  "Ojo",
  "Danjuma",
  "Chukwu",
  "Adeleke",
  "Oduya",
  "Abdullahi",
  "Osei",
  "Ibe",
  "Oni",
  "Ekpo",
  "Sani",
  "Umeh",
];

const DEMO_STATUSES: OfficePresenceStatus[] = [
  "online",
  "online",
  "idle",
  "online",
  "away",
  "call",
  "online",
  "dnd",
];

/** The tints the directory gives the people who fill the upper storeys. */
const DEMO_TINTS = [
  "#f472b6",
  "#34d399",
  "#f59e0b",
  "#60a5fa",
  "#22d3ee",
  "#a78bfa",
  "#fb7185",
  "#4ade80",
  "#38bdf8",
  "#e879f9",
];

export function demoTowerFloors(): OfficeFloor[] {
  return [
    {
      index: 0,
      kind: "general",
      name: "General 1",
      capacity: 12,
      members: 0,
      hasPortal: false,
    },
    {
      index: 1,
      kind: "general",
      name: "General 2",
      capacity: 12,
      members: 0,
      hasPortal: false,
    },
    ...Array.from({ length: DEMO_STOREYS }, (_, offset) => ({
      index: offset + 2,
      kind: "member" as const,
      name: `Floor ${offset + 1}`,
      capacity: DEMO_CAPACITY,
      members: DEMO_CAPACITY,
      hasPortal: true,
    })),
  ];
}

function fillerName(seed: number): string {
  const first = DEMO_FIRST_NAMES[seed % DEMO_FIRST_NAMES.length];
  const last =
    DEMO_LAST_NAMES[
      Math.floor(seed / DEMO_FIRST_NAMES.length) % DEMO_LAST_NAMES.length
    ];
  return `${first} ${last}`;
}

/** The directory the tower draws, including the demo's filler storeys. */
export function demoTowerOffices(
  rooms: OfficeRoom[],
  presence: ReadonlyArray<{
    roomId: string;
    status?: OfficePresenceStatus;
    tint?: string;
  }>
): TowerOffice[] {
  const byRoom = new Map(presence.map((point) => [point.roomId, point]));
  // A private office is coloured by its owner's own avatar, the same tint that
  // paints their body in the office view — not by the room's accent.
  const ownerByRoom = new Map<string, string>();
  for (const user of DEMO_USERS) {
    if (user.isZoe || user.id === "you") continue;
    if (!ownerByRoom.has(user.roomId)) {
      ownerByRoom.set(user.roomId, user.avatar.tint);
    }
  }
  const realRooms = rooms.filter((room) => room.kind !== "area");
  const offices: TowerOffice[] = [];

  for (const floor of demoTowerFloors()) {
    const onFloor = realRooms.filter(
      (room) => (room.floorIndex ?? 0) === floor.index
    );
    for (const room of onFloor) {
      const here = room.kind === "personal" ? byRoom.get(room.id) : undefined;
      const personal = room.kind === "personal";
      offices.push({
        roomId: room.id,
        floorIndex: floor.index,
        name: room.name,
        kind: room.kind,
        // A private office belongs to somebody whether or not they are in it.
        occupantName: personal ? room.name : undefined,
        present: Boolean(here),
        status: here?.status ?? (personal ? "away" : undefined),
        tint: here?.tint ?? ownerByRoom.get(room.id) ?? room.accent,
        avatarUrl: personal ? uiAvatarUrl(room.name) : undefined,
      });
    }

    if (floor.kind !== "member") continue;

    const personalOnFloor = onFloor.filter(
      (room) => room.kind === "personal"
    ).length;
    const fillers = floor.capacity - personalOnFloor;
    for (let slot = 0; slot < fillers; slot += 1) {
      const seed = (floor.index - 1) * DEMO_CAPACITY + slot;
      const person = fillerName(seed);
      const occupied = (seed * 7 + 3) % 10 < 4;
      offices.push({
        roomId: `demo-office:${floor.index}:${slot}`,
        floorIndex: floor.index,
        name: person,
        kind: "personal",
        occupantName: person,
        present: occupied,
        status: occupied ? DEMO_STATUSES[seed % DEMO_STATUSES.length] : "away",
        tint: DEMO_TINTS[seed % DEMO_TINTS.length],
        avatarUrl: uiAvatarUrl(person),
        interactive: false,
      });
    }
  }

  return offices;
}

/** The demo lives entirely in the browser: seeded data plus localStorage. */
export const demoSource: OfficeSource = {
  mode: "demo",
  floors: demoTowerFloors(),
  members: DEMO_USERS.filter((user) => !user.isZoe).map((user) => {
    const room = ROOMS.find((r) => r.id === user.roomId);
    return {
      userId: user.id,
      displayName: user.name,
      username: user.username,
      title: user.role,
      avatarUrl: uiAvatarUrl(user.name),
      tint: user.avatar.tint,
      floorIndex: room?.floorIndex ?? 0,
      roomId: user.roomId,
      online: user.status !== "away",
      status: user.status,
      canVisit: user.status !== "away",
    };
  }),
  rooms: ROOMS as unknown as OfficeRoom[],
  initialLayouts: {},
  initialMessages: {},
  initialAvatar: DEFAULT_AVATAR,

  async loadLayouts() {
    const layouts: Record<string, OfficeFurnitureItem[]> = {};
    for (const room of ROOMS) {
      layouts[room.id] = (DEMO_LAYOUTS[room.id] ?? []).map(
        (item: FurnitureItem) => ({ ...item })
      );
    }

    try {
      const saved = localStorage.getItem(KEY_LAYOUTS);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<
          string,
          OfficeFurnitureItem[]
        >;
        for (const [roomId, items] of Object.entries(parsed)) {
          const room = ROOMS.find((r) => r.id === roomId);
          if (room && Array.isArray(items)) {
            layouts[roomId] = items.filter(
              (item) =>
                item.x >= room.bounds.x - 0.2 &&
                item.x <= room.bounds.x + room.bounds.w + 0.2 &&
                item.z >= room.bounds.z - 0.2 &&
                item.z <= room.bounds.z + room.bounds.d + 0.2
            );
          }
        }
      }
    } catch {
      // local storage is best effort in the demo
    }

    return layouts;
  },

  async saveLayout(roomId, items) {
    const layouts = readStoredLayouts();
    layouts[roomId] = items;
    writeStoredLayouts(layouts);
  },

  async publishLayout(roomId, items) {
    await this.saveLayout(roomId, items);
  },

  async resetLayout(roomId) {
    const defaults = (DEMO_LAYOUTS[roomId] ?? []).map(
      (item: FurnitureItem) => ({ ...item })
    );
    await this.saveLayout(roomId, defaults);
    return defaults;
  },

  async saveAvatar(avatar: OfficeAvatarConfig) {
    try {
      localStorage.setItem(KEY_AVATAR, JSON.stringify(avatar));
    } catch {
      // ignore
    }
  },

  async sendMessage(roomId, text) {
    const reply: OfficeChatMessage = {
      id: `demo-reply-${Date.now()}`,
      roomId,
      userId: "demo",
      name: "Colleague",
      text: "Sounds good.",
      at: Date.now(),
    };
    return [reply];
  },

  async askZoe(question: string, context: OfficeZoeContext) {
    const nearby = context.nearbyUsers.length
      ? context.nearbyUsers.map((user) => user.displayName).join(", ")
      : "nobody else in this room";
    const base = zoeAnswer(question, context.room.name);
    return `${base}\n\nNearby right now: ${nearby}.`;
  },

  async enterRoom() {
    // The demo has no server to tell.
  },

  async leaveRoom() {
    // The demo has no server to tell.
  },

  async fetchOccupants(_roomId: string): Promise<OfficeOccupant[]> {
    return [];
  },

  subscribePresence(
    _roomId: string,
    _onPresence: (occupants: OfficeOccupant[]) => void
  ) {
    return () => {};
  },

  fetchMessages(_roomId: string): Promise<OfficeChatMessage[]> {
    // The demo's conversations are seeded and simulated, so there is nothing
    // to read from a server.
    return Promise.resolve([]);
  },

  subscribeMessages(
    _roomId: string,
    _onMessage: (message: OfficeChatMessage) => void
  ) {
    return () => {};
  },

  subscribeRooms(callback: (rooms: OfficeRoom[]) => void) {
    callback(this.rooms);
    return () => {};
  },
};

function readStoredLayouts(): Record<string, OfficeFurnitureItem[]> {
  try {
    const saved = localStorage.getItem(KEY_LAYOUTS);
    return saved
      ? (JSON.parse(saved) as Record<string, OfficeFurnitureItem[]>)
      : {};
  } catch {
    return {};
  }
}

function writeStoredLayouts(layouts: Record<string, OfficeFurnitureItem[]>) {
  try {
    localStorage.setItem(KEY_LAYOUTS, JSON.stringify(layouts));
  } catch {
    // ignore
  }
}

/** Chat seeds for the demo, keyed by room id. */
export function demoChatSeeds(): Record<string, OfficeChatMessage[]> {
  return { ...CHAT_SEEDS } as unknown as Record<string, OfficeChatMessage[]>;
}

/** The avatar the demo starts with, restored from localStorage when present. */
export function demoAvatar(): OfficeAvatarConfig {
  try {
    const saved = localStorage.getItem(KEY_AVATAR);
    if (saved) {
      return { ...DEFAULT_AVATAR, ...JSON.parse(saved) };
    }
  } catch {
    // ignore
  }
  return DEFAULT_AVATAR;
}

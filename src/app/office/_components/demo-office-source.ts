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
  OfficePresenceState,
  OfficePresenceStatus,
  OfficeRoom,
  OfficeSource,
  OfficeZoeContext,
} from "~/types/office";
import type { TowerOffice } from "./engine/tower-scene";
import {
  personalOfficeTemplate,
  withPersonalOfficeDefaults,
} from "./office-layout";

const KEY_LAYOUTS = "office-demo-layouts-v1";
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
      name: "General",
      capacity: 0,
      members: 0,
      hasPortal: false,
    },
    ...Array.from({ length: DEMO_STOREYS }, (_, offset) => ({
      index: offset + 1,
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
  const realRooms = rooms.filter(
    (room) => room.kind === "personal" || room.kind === "channel"
  );
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
        interactive: false,
      });
    }
  }

  return offices;
}

const DEMO_CHANNEL_NAME = "zedu_office_demo_multiplayer";

let demoBroadcastChannel: BroadcastChannel | null = null;
function getDemoChannel(): BroadcastChannel | null {
  if (
    typeof window === "undefined" ||
    typeof BroadcastChannel === "undefined"
  ) {
    return null;
  }
  if (!demoBroadcastChannel) {
    try {
      demoBroadcastChannel = new BroadcastChannel(DEMO_CHANNEL_NAME);
    } catch {
      demoBroadcastChannel = null;
    }
  }
  return demoBroadcastChannel;
}

const demoRoomOccupants = new Map<string, Map<string, OfficeOccupant>>();

function getDemoIdentity() {
  if (typeof window === "undefined") {
    return { id: "demo_player", name: "Colleague", tint: "#8b5cf6" };
  }
  const w = window as any;
  if (w.__officeTabIdentity) {
    return w.__officeTabIdentity;
  }
  const id = `demo_${Math.random().toString(36).slice(2, 8)}`;
  const names = [
    "Alex",
    "Jordan",
    "Taylor",
    "Casey",
    "Morgan",
    "Sam",
    "Kai",
    "Riley",
    "Quinn",
    "Avery",
  ];
  const name = names[Math.floor(Math.random() * names.length)];
  const tints = [
    "#8b5cf6",
    "#3b82f6",
    "#10b981",
    "#f59e0b",
    "#ec4899",
    "#06b6d4",
  ];
  const tint = tints[Math.floor(Math.random() * tints.length)];
  const identity = { id, name, tint };
  w.__officeTabIdentity = identity;
  try {
    sessionStorage.setItem("office_session_user_id", id);
    sessionStorage.setItem("office_session_user_name", name);
    sessionStorage.setItem("office_session_user_tint", tint);
  } catch {
    // Ignore storage issues in restricted environments
  }
  return identity;
}

let latestLocalPose: {
  roomId: string;
  x: number;
  z: number;
  yaw: number;
} | null = null;

/** The demo lives entirely in the browser: seeded data plus localStorage. */
export const demoSource: OfficeSource = {
  mode: "demo",
  floors: demoTowerFloors(),
  members: DEMO_USERS.filter((user) => !user.isZoe).map((user) => ({
    userId: user.id,
    displayName: user.name,
    username: user.username,
    title: user.role,
    tint: user.avatar.tint,
    floorIndex: 1,
    roomId: user.roomId,
    online: user.status !== "away",
    status: user.status,
    canVisit: true,
  })),
  rooms: ROOMS as unknown as OfficeRoom[],
  initialLayouts: withPersonalOfficeDefaults(
    ROOMS as unknown as OfficeRoom[],
    Object.fromEntries(
      Object.entries(DEMO_LAYOUTS).map(([roomId, items]) => [
        roomId,
        items.map((item) => ({ ...item, roomId })),
      ])
    )
  ),
  initialMessages: demoChatSeeds(),
  initialAvatar: DEFAULT_AVATAR,

  async loadLayouts() {
    const layouts: Record<string, OfficeFurnitureItem[]> = {};
    for (const [roomId, items] of Object.entries(DEMO_LAYOUTS)) {
      layouts[roomId] = items.map((item: FurnitureItem) => ({
        ...item,
        roomId,
      }));
    }

    try {
      const saved = localStorage.getItem(KEY_LAYOUTS);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<
          string,
          OfficeFurnitureItem[]
        >;
        for (const [roomId, items] of Object.entries(parsed)) {
          if (Array.isArray(items)) {
            layouts[roomId] = items.map((item) => ({ ...item, roomId }));
          }
        }
      }
    } catch {
      // local storage is best effort in the demo
    }

    return withPersonalOfficeDefaults(
      ROOMS as unknown as OfficeRoom[],
      layouts
    );
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
    const room = (ROOMS as unknown as OfficeRoom[]).find(
      (candidate) => candidate.id === roomId
    );
    const defaults =
      DEMO_LAYOUTS[roomId]?.map((item: FurnitureItem) => ({
        ...item,
        roomId,
      })) ??
      (room && room.kind === "personal" ? personalOfficeTemplate(room) : []);
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
      name: "Teammate",
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

  async enterRoom(roomId: string) {
    const channel = getDemoChannel();
    if (!channel || typeof window === "undefined") return;

    const identity = getDemoIdentity();
    const spawnPos =
      latestLocalPose && latestLocalPose.roomId === roomId
        ? { x: latestLocalPose.x, z: latestLocalPose.z }
        : { x: 8.5, z: 9.4 };

    const occupant: OfficeOccupant = {
      userId: identity.id,
      displayName: identity.name,
      username: identity.name.toLowerCase(),
      avatar: {
        tint: identity.tint,
        body: "b",
        outfit: "smart",
        accessory: "glasses",
      },
      roomId,
      status: "online",
      position: { x: spawnPos.x, y: 0, z: spawnPos.z },
      rotation: latestLocalPose?.yaw ?? Math.PI,
      updatedAt: new Date().toISOString(),
    };

    channel.postMessage({
      type: "join",
      roomId,
      occupant,
    });
  },

  async leaveRoom(roomId: string) {
    const channel = getDemoChannel();
    if (!channel || typeof window === "undefined") return;

    const identity = getDemoIdentity();
    channel.postMessage({
      type: "leave",
      roomId,
      userId: identity.id,
    });
  },

  async sendPosition(roomId: string, x: number, z: number, yaw: number) {
    const channel = getDemoChannel();
    if (!channel || typeof window === "undefined") return 200;

    const identity = getDemoIdentity();
    latestLocalPose = { roomId, x, z, yaw };

    const occupant: OfficeOccupant = {
      userId: identity.id,
      displayName: identity.name,
      username: identity.name.toLowerCase(),
      avatar: {
        tint: identity.tint,
        body: "b",
        outfit: "smart",
        accessory: "glasses",
      },
      roomId,
      status: "online",
      position: { x, y: 0, z },
      rotation: yaw,
      updatedAt: new Date().toISOString(),
    };

    channel.postMessage({
      type: "position",
      roomId,
      occupant,
    });
    return 200;
  },

  async fetchOccupants(roomId: string): Promise<OfficeOccupant[]> {
    const roomMap = demoRoomOccupants.get(roomId);
    if (!roomMap) return [];
    const identity = getDemoIdentity();
    return [...roomMap.values()].filter((occ) => occ.userId !== identity.id);
  },

  subscribePresence(
    roomId: string,
    onPresence: (occupants: OfficeOccupant[]) => void,
    onState?: (state: OfficePresenceState) => void
  ) {
    const channel = getDemoChannel();
    if (!channel || typeof window === "undefined") {
      onState?.("live");
      onPresence([]);
      return () => {};
    }

    let roomMap = demoRoomOccupants.get(roomId);
    if (!roomMap) {
      roomMap = new Map<string, OfficeOccupant>();
      demoRoomOccupants.set(roomId, roomMap);
    }

    const identity = getDemoIdentity();

    const emit = () => {
      const others = [...(roomMap?.values() ?? [])].filter(
        (occ) => occ.userId !== identity.id
      );
      onPresence(others);
    };

    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.roomId !== roomId) return;

      if (data.type === "join" || data.type === "position") {
        if (data.occupant && data.occupant.userId !== identity.id) {
          roomMap?.set(data.occupant.userId, data.occupant);
          emit();
          if (data.type === "join") {
            const curX =
              latestLocalPose && latestLocalPose.roomId === roomId
                ? latestLocalPose.x
                : 8.5;
            const curZ =
              latestLocalPose && latestLocalPose.roomId === roomId
                ? latestLocalPose.z
                : 9.4;
            const curYaw =
              latestLocalPose && latestLocalPose.roomId === roomId
                ? latestLocalPose.yaw
                : Math.PI;
            channel.postMessage({
              type: "position",
              roomId,
              occupant: {
                userId: identity.id,
                displayName: identity.name,
                username: identity.name.toLowerCase(),
                avatar: {
                  tint: identity.tint,
                  body: "b",
                  outfit: "smart",
                  accessory: "glasses",
                },
                roomId,
                status: "online",
                position: { x: curX, y: 0, z: curZ },
                rotation: curYaw,
                updatedAt: new Date().toISOString(),
              },
            });
          }
        }
      } else if (data.type === "leave") {
        if (data.userId) {
          roomMap?.delete(data.userId);
          emit();
        }
      } else if (data.type === "query") {
        const curX =
          latestLocalPose && latestLocalPose.roomId === roomId
            ? latestLocalPose.x
            : 8.5;
        const curZ =
          latestLocalPose && latestLocalPose.roomId === roomId
            ? latestLocalPose.z
            : 9.4;
        const curYaw =
          latestLocalPose && latestLocalPose.roomId === roomId
            ? latestLocalPose.yaw
            : Math.PI;

        channel.postMessage({
          type: "join",
          roomId,
          occupant: {
            userId: identity.id,
            displayName: identity.name,
            username: identity.name.toLowerCase(),
            avatar: {
              tint: identity.tint,
              body: "b",
              outfit: "smart",
              accessory: "glasses",
            },
            roomId,
            status: "online",
            position: { x: curX, y: 0, z: curZ },
            rotation: curYaw,
            updatedAt: new Date().toISOString(),
          },
        });
      }
    };

    channel.addEventListener("message", handler);
    onState?.("live");
    channel.postMessage({ type: "query", roomId });
    emit();

    return () => {
      channel.removeEventListener("message", handler);
    };
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

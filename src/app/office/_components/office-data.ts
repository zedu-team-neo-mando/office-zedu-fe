// Shared demo data for The Office walkthrough.
// Everything here is presentation data for the standalone demo route. The live
// route reads the same shapes from the zedu-be office bootstrap endpoint.

export type RoomKind =
  | "reception"
  | "lobby"
  | "lounge"
  | "meeting"
  | "focus"
  | "channel"
  | "personal"
  | "area";

export type PresenceStatus = "online" | "idle" | "away" | "call" | "dnd";

export type BodyPreset = "a" | "b" | "c";
export type OutfitPreset = "casual" | "smart" | "hoodie" | "lab";
export type AccessoryPreset = "none" | "headphones" | "glasses" | "cap";

export interface AvatarConfig {
  tint: string;
  body: BodyPreset;
  outfit: OutfitPreset;
  accessory: AccessoryPreset;
}

export interface Bounds {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface OfficeRoom {
  id: string;
  kind: RoomKind;
  name: string;
  shortName: string;
  refId?: string;
  capacity: number;
  locked: boolean;
  /** Storey of the tower. The general floor is 0; member floors start at 1. */
  floorIndex?: number;
  accent: string;
  floor: string;
  bounds: Bounds;
  ownerId?: string;
  description: string;
  spawn: { x: number; z: number };
  door: { x: number; z: number };
  chat: boolean;
}

export interface FurnitureItem {
  id: string;
  catalogId: string;
  x: number;
  z: number;
  rotation: 0 | 90 | 180 | 270;
  variant?: string;
  roomId?: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  category: "Work" | "Lounge" | "Decor";
  footprint: { w: number; d: number };
  rotatable: boolean;
  collision: boolean;
  maxPerRoom: number;
  color: string;
  blurb: string;
}

export interface DemoUser {
  id: string;
  name: string;
  username: string;
  role: string;
  status: PresenceStatus;
  roomId: string;
  position: { x: number; z: number };
  avatar: AvatarConfig;
  waypoints?: Array<{ x: number; z: number }>;
  speed?: number;
  bubble?: string;
  isZoe?: boolean;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  name: string;
  text: string;
  at: number;
  self?: boolean;
}

export const BUILDING = {
  minX: 0,
  maxX: 56,
  minZ: 0,
  maxZ: 36,
  mainMaxX: 44,
  privateMinZ: 8,
  wallHeight: 2.8,
  tile: 1,
};

export const ROOMS: OfficeRoom[] = [
  {
    id: "reception",
    kind: "reception",
    name: "Reception",
    shortName: "Reception",
    capacity: 60,
    locked: false,
    accent: "#a78bfa",
    floor: "#261f3d",
    bounds: { x: 1.6, z: 1.6, w: 14.8, d: 10.8 },
    description: "Spawn point, Zoe's desk and the noticeboard.",
    spawn: { x: 8.5, z: 9.4 },
    door: { x: 9, z: 13 },
    chat: true,
  },
  {
    id: "meeting:1",
    kind: "meeting",
    name: "Meeting A",
    shortName: "Meeting A",
    capacity: 8,
    locked: false,
    accent: "#22d3ee",
    floor: "#172838",
    bounds: { x: 18.2, z: 1.6, w: 10.6, d: 10.8 },
    description: "Buzz-enabled room for up to eight people.",
    spawn: { x: 23.5, z: 10.4 },
    door: { x: 23.5, z: 13 },
    chat: true,
  },
  {
    id: "meeting:2",
    kind: "meeting",
    name: "Meeting B",
    shortName: "Meeting B",
    capacity: 8,
    locked: false,
    accent: "#38bdf8",
    floor: "#172838",
    bounds: { x: 31.2, z: 1.6, w: 10.6, d: 10.8 },
    description: "Quiet room for reviews and pairing.",
    spawn: { x: 36.5, z: 10.4 },
    door: { x: 36.5, z: 13 },
    chat: true,
  },
  {
    id: "lounge",
    kind: "lounge",
    name: "Lounge",
    shortName: "Lounge",
    capacity: 30,
    locked: false,
    accent: "#f59e0b",
    floor: "#2b2318",
    bounds: { x: 1.6, z: 14.1, w: 16.4, d: 9.8 },
    description: "Sofas, coffee and proximity chat.",
    spawn: { x: 9, z: 22.4 },
    door: { x: 9, z: 14 },
    chat: true,
  },
  {
    id: "focus:1",
    kind: "focus",
    name: "Focus 01",
    shortName: "Focus 01",
    capacity: 1,
    locked: false,
    accent: "#34d399",
    floor: "#15251f",
    bounds: { x: 19.8, z: 14.2, w: 6.6, d: 4.2 },
    description: "Single occupancy. Sets your status to DND.",
    spawn: { x: 23.1, z: 17.2 },
    door: { x: 23.1, z: 18.4 },
    chat: false,
  },
  {
    id: "focus:2",
    kind: "focus",
    name: "Focus 02",
    shortName: "Focus 02",
    capacity: 1,
    locked: false,
    accent: "#34d399",
    floor: "#15251f",
    bounds: { x: 28.3, z: 14.2, w: 6.6, d: 4.2 },
    description: "Single occupancy. Sets your status to DND.",
    spawn: { x: 31.6, z: 17.2 },
    door: { x: 31.6, z: 18.4 },
    chat: false,
  },
  {
    id: "focus:3",
    kind: "focus",
    name: "Focus 03",
    shortName: "Focus 03",
    capacity: 1,
    locked: false,
    accent: "#34d399",
    floor: "#15251f",
    bounds: { x: 19.8, z: 20.3, w: 6.6, d: 4.2 },
    description: "Single occupancy. Sets your status to DND.",
    spawn: { x: 23.1, z: 23.3 },
    door: { x: 23.1, z: 20.3 },
    chat: false,
  },
  {
    id: "focus:4",
    kind: "focus",
    name: "Focus 04",
    shortName: "Focus 04",
    capacity: 1,
    locked: false,
    accent: "#34d399",
    floor: "#15251f",
    bounds: { x: 28.3, z: 20.3, w: 6.6, d: 4.2 },
    description: "Single occupancy. Sets your status to DND.",
    spawn: { x: 31.6, z: 23.3 },
    door: { x: 31.6, z: 20.3 },
    chat: false,
  },
  {
    id: "channel:general",
    kind: "channel",
    name: "#general",
    shortName: "#general",
    refId: "ch_general",
    capacity: 30,
    locked: false,
    accent: "#60a5fa",
    floor: "#172536",
    bounds: { x: 1.6, z: 26.4, w: 9.8, d: 8.6 },
    description: "The whole-team channel, mapped to #general.",
    spawn: { x: 6.5, z: 33.7 },
    door: { x: 6.5, z: 26.4 },
    chat: true,
  },
  {
    id: "channel:design",
    kind: "channel",
    name: "#design",
    shortName: "#design",
    refId: "ch_design",
    capacity: 30,
    locked: false,
    accent: "#f472b6",
    floor: "#2a1b2c",
    bounds: { x: 12.6, z: 26.4, w: 9.8, d: 8.6 },
    description: "Design critique, Figma links and screenshots.",
    spawn: { x: 17.5, z: 33.7 },
    door: { x: 17.5, z: 26.4 },
    chat: true,
  },
  {
    id: "channel:dev",
    kind: "channel",
    name: "#dev",
    shortName: "#dev",
    refId: "ch_dev",
    capacity: 30,
    locked: false,
    accent: "#34d399",
    floor: "#16261f",
    bounds: { x: 23.6, z: 26.4, w: 9.8, d: 8.6 },
    description: "Deploys, reviews and the occasional incident.",
    spawn: { x: 28.5, z: 33.7 },
    door: { x: 28.5, z: 26.4 },
    chat: true,
  },
  {
    id: "channel:marketing",
    kind: "channel",
    name: "#marketing",
    shortName: "#marketing",
    refId: "ch_marketing",
    capacity: 30,
    locked: true,
    accent: "#fbbf24",
    floor: "#2a2317",
    bounds: { x: 34.6, z: 26.4, w: 7.8, d: 8.6 },
    description: "You are not a member. Join the channel in Zedu to enter.",
    spawn: { x: 38.5, z: 33.7 },
    door: { x: 38.5, z: 26.4 },
    chat: true,
  },
  {
    id: "personal:ada",
    kind: "personal",
    name: "Ada's office",
    shortName: "Ada's office",
    capacity: 4,
    locked: false,
    accent: "#f472b6",
    floor: "#251d31",
    bounds: { x: 49.4, z: 9.2, w: 6.1, d: 6.8 },
    ownerId: "ada",
    floorIndex: 1,
    description: "Private office. Read-only for DM guests.",
    spawn: { x: 50.5, z: 14.5 },
    door: { x: 49.4, z: 12.5 },
    chat: true,
  },
  {
    id: "personal:tunde",
    kind: "personal",
    name: "Tunde's office",
    shortName: "Tunde's office",
    capacity: 4,
    locked: false,
    accent: "#34d399",
    floor: "#1d2730",
    bounds: { x: 49.4, z: 17.2, w: 6.1, d: 6.8 },
    ownerId: "tunde",
    floorIndex: 1,
    description: "Private office. Read-only for DM guests.",
    spawn: { x: 50.5, z: 22.5 },
    door: { x: 49.4, z: 20.5 },
    chat: true,
  },
  {
    id: "personal:you",
    kind: "personal",
    name: "Your office",
    shortName: "Your office",
    capacity: 4,
    locked: false,
    accent: "#a78bfa",
    floor: "#241d39",
    bounds: { x: 49.4, z: 25.2, w: 6.1, d: 8.8 },
    ownerId: "you",
    floorIndex: 2,
    description: "Yours to furnish. Guests visit read-only.",
    spawn: { x: 51.5, z: 28 },
    door: { x: 49.4, z: 29.5 },
    chat: true,
  },
  {
    id: "area:1:visitors",
    kind: "area",
    name: "Visitors area",
    shortName: "Visitors",
    capacity: 12,
    locked: false,
    floorIndex: 1,
    accent: "#38bdf8",
    floor: "#16202c",
    bounds: { x: 12, z: 4.5, w: 8.4, d: 6.8 },
    description: "Where guests wait for the people on this floor.",
    spawn: { x: 16.2, z: 8.4 },
    door: { x: 12, z: 8.4 },
    chat: true,
  },
  {
    id: "area:2:pods",
    kind: "area",
    name: "Open pods",
    shortName: "Pods",
    capacity: 16,
    locked: false,
    floorIndex: 2,
    accent: "#34d399",
    floor: "#17251f",
    bounds: { x: 12, z: 4.5, w: 8.4, d: 6.8 },
    description: "Quiet desks for whoever is on this floor.",
    spawn: { x: 16.2, z: 8.4 },
    door: { x: 12, z: 8.4 },
    chat: true,
  },
];

export const ROOM_BY_ID: Record<string, OfficeRoom> = Object.fromEntries(
  ROOMS.map((room) => [room.id, room])
);

export const DEFAULT_ROOM = ROOM_BY_ID.reception;

export const ROOM_GROUPS: Array<{
  label: string;
  ids: string[];
  kind?: RoomKind;
}> = [
  {
    label: "Shared spaces",
    ids: ["reception", "lounge", "meeting:1", "meeting:2"],
  },
  {
    label: "Channels",
    kind: "channel",
    ids: [],
  },
  { label: "Focus pods", ids: ["focus:1", "focus:2", "focus:3", "focus:4"] },
  {
    label: "Private wing",
    ids: ["personal:you", "personal:ada", "personal:tunde"],
  },
];

export const FURNITURE_CATALOG: CatalogItem[] = [
  {
    id: "desk_oak",
    name: "Oak desk",
    category: "Work",
    footprint: { w: 2, d: 1 },
    rotatable: true,
    collision: true,
    maxPerRoom: 4,
    color: "#b98552",
    blurb: "A warm two-seater desk.",
  },
  {
    id: "chair_ergo",
    name: "Ergo chair",
    category: "Work",
    footprint: { w: 1, d: 1 },
    rotatable: true,
    collision: true,
    maxPerRoom: 8,
    color: "#40514a",
    blurb: "Mesh back, five-star base.",
  },
  {
    id: "table_meeting",
    name: "Meeting table",
    category: "Work",
    footprint: { w: 3, d: 2 },
    rotatable: true,
    collision: true,
    maxPerRoom: 2,
    color: "#d8dbea",
    blurb: "Seats six with room to spare.",
  },
  {
    id: "sofa",
    name: "Soft sofa",
    category: "Lounge",
    footprint: { w: 2, d: 1 },
    rotatable: true,
    collision: true,
    maxPerRoom: 3,
    color: "#4b5a8a",
    blurb: "Two seats and a lot of calm.",
  },
  {
    id: "coffee_table",
    name: "Coffee table",
    category: "Lounge",
    footprint: { w: 2, d: 1 },
    rotatable: true,
    collision: true,
    maxPerRoom: 3,
    color: "#8f6a4a",
    blurb: "Low table for the lounge corner.",
  },
  {
    id: "plant",
    name: "Monstera",
    category: "Decor",
    footprint: { w: 1, d: 1 },
    rotatable: false,
    collision: true,
    maxPerRoom: 8,
    color: "#3b9b6d",
    blurb: "A little green goes a long way.",
  },
  {
    id: "whiteboard",
    name: "Whiteboard",
    category: "Work",
    footprint: { w: 2, d: 1 },
    rotatable: true,
    collision: true,
    maxPerRoom: 2,
    color: "#eef2ff",
    blurb: "For sketches and sprint plans.",
  },
  {
    id: "screen",
    name: "Studio screen",
    category: "Work",
    footprint: { w: 2, d: 1 },
    rotatable: true,
    collision: true,
    maxPerRoom: 2,
    color: "#1f2937",
    blurb: "A display for reviews and calls.",
  },
  {
    id: "rug",
    name: "Woven rug",
    category: "Decor",
    footprint: { w: 3, d: 2 },
    rotatable: true,
    collision: false,
    maxPerRoom: 2,
    color: "#2d7663",
    blurb: "Defines a zone without a wall.",
  },
  {
    id: "lamp",
    name: "Arc lamp",
    category: "Decor",
    footprint: { w: 1, d: 1 },
    rotatable: false,
    collision: true,
    maxPerRoom: 4,
    color: "#f4c46a",
    blurb: "Warm pool of light.",
  },
  {
    id: "shelf",
    name: "Bookshelf",
    category: "Work",
    footprint: { w: 1, d: 1 },
    rotatable: true,
    collision: true,
    maxPerRoom: 4,
    color: "#7a563c",
    blurb: "Books, plants and tiny trophies.",
  },
  {
    id: "beanbag",
    name: "Bean bag",
    category: "Lounge",
    footprint: { w: 1, d: 1 },
    rotatable: false,
    collision: true,
    maxPerRoom: 4,
    color: "#e879a7",
    blurb: "For the 3pm dip.",
  },
  {
    id: "armchair",
    name: "Armchair",
    category: "Lounge",
    footprint: { w: 1, d: 1 },
    rotatable: true,
    collision: true,
    maxPerRoom: 4,
    color: "#c38a64",
    blurb: "A deep seat for reading or a call.",
  },
  {
    id: "coffee_bar",
    name: "Coffee bar",
    category: "Lounge",
    footprint: { w: 2, d: 1 },
    rotatable: true,
    collision: true,
    maxPerRoom: 1,
    color: "#88684c",
    blurb: "Espresso machine and a row of mugs.",
  },
  {
    id: "cabinet",
    name: "Filing cabinet",
    category: "Work",
    footprint: { w: 1, d: 1 },
    rotatable: true,
    collision: true,
    maxPerRoom: 3,
    color: "#9aa4ac",
    blurb: "Three drawers for the paperwork.",
  },
  {
    id: "art_easel",
    name: "Art easel",
    category: "Decor",
    footprint: { w: 1, d: 1 },
    rotatable: true,
    collision: true,
    maxPerRoom: 2,
    color: "#ffe7bd",
    blurb: "A framed print to make it yours.",
  },
];

/** Furniture you can sit on, and how high its seat is. */
export const SEAT_HEIGHT: Record<string, number> = {
  chair_ergo: 0.5,
  sofa: 0.6,
  beanbag: 0.42,
  armchair: 0.48,
};

export const CATALOG_BY_ID: Record<string, CatalogItem> = Object.fromEntries(
  FURNITURE_CATALOG.map((item) => [item.id, item])
);

export const DEFAULT_AVATAR: AvatarConfig = {
  tint: "#8b5cf6",
  body: "b",
  outfit: "smart",
  accessory: "glasses",
};

export const AVATAR_TINTS = [
  "#8b5cf6",
  "#60a5fa",
  "#34d399",
  "#f472b6",
  "#f59e0b",
  "#22d3ee",
  "#fb7185",
  "#e5e7eb",
];

export const BODY_OPTIONS: Array<{ id: BodyPreset; label: string }> = [
  { id: "a", label: "Slim" },
  { id: "b", label: "Balanced" },
  { id: "c", label: "Broad" },
];

export const OUTFIT_OPTIONS: Array<{ id: OutfitPreset; label: string }> = [
  { id: "smart", label: "Smart" },
  { id: "casual", label: "Casual" },
  { id: "hoodie", label: "Hoodie" },
  { id: "lab", label: "Studio" },
];

export const ACCESSORY_OPTIONS: Array<{ id: AccessoryPreset; label: string }> =
  [
    { id: "none", label: "None" },
    { id: "glasses", label: "Glasses" },
    { id: "headphones", label: "Headphones" },
    { id: "cap", label: "Cap" },
  ];

export const DEMO_USER_ID = "you";
export const DEMO_ORG = { id: "org_hng", name: "Zedu HQ", slug: "zedu-hq" };

export const DEMO_USERS: DemoUser[] = [
  {
    id: "ada",
    name: "Ada Obi",
    username: "ada",
    role: "Product Designer",
    status: "online",
    roomId: "channel:design",
    position: { x: 15, z: 29.2 },
    avatar: {
      tint: "#f472b6",
      body: "a",
      outfit: "casual",
      accessory: "headphones",
    },
    waypoints: [
      { x: 14.5, z: 28.4 },
      { x: 20.5, z: 28.4 },
      { x: 20.5, z: 33.2 },
      { x: 14.5, z: 33.2 },
    ],
    speed: 0.55,
    bubble: "The new room labels are live ✨",
  },
  {
    id: "tunde",
    name: "Tunde Bello",
    username: "tunde",
    role: "Backend Engineer",
    status: "online",
    roomId: "channel:dev",
    position: { x: 26.5, z: 29.2 },
    avatar: { tint: "#34d399", body: "c", outfit: "hoodie", accessory: "cap" },
    waypoints: [
      { x: 25.5, z: 28.4 },
      { x: 31.5, z: 28.4 },
      { x: 31.5, z: 33.2 },
      { x: 25.5, z: 33.2 },
    ],
    speed: 0.5,
    bubble: "Presence is at 10Hz now.",
  },
  {
    id: "maya",
    name: "Maya Eze",
    username: "maya",
    role: "Engineering Manager",
    status: "call",
    roomId: "meeting:1",
    position: { x: 24.4, z: 7.2 },
    avatar: { tint: "#f59e0b", body: "b", outfit: "smart", accessory: "none" },
    bubble: "On a Buzz call",
  },
  {
    id: "leo",
    name: "Leo Adeyemi",
    username: "leo",
    role: "Growth Lead",
    status: "online",
    roomId: "lounge",
    position: { x: 5.4, z: 21.6 },
    avatar: { tint: "#60a5fa", body: "a", outfit: "casual", accessory: "cap" },
    waypoints: [
      { x: 3.2, z: 21.8 },
      { x: 15.2, z: 21.8 },
      { x: 15.2, z: 16.2 },
      { x: 3.2, z: 16.2 },
    ],
    speed: 0.45,
    bubble: "Coffee run, anyone?",
  },
  {
    id: "ife",
    name: "Ife Nwosu",
    username: "ife",
    role: "Data Analyst",
    status: "dnd",
    roomId: "focus:2",
    position: { x: 31.6, z: 16.9 },
    avatar: { tint: "#22d3ee", body: "c", outfit: "lab", accessory: "glasses" },
    bubble: "Heads down until 3",
  },
  {
    id: "nia",
    name: "Nia Hart",
    username: "nia",
    role: "Community Lead",
    status: "online",
    roomId: "reception",
    position: { x: 13.2, z: 7.2 },
    avatar: { tint: "#fb7185", body: "b", outfit: "smart", accessory: "none" },
    waypoints: [
      { x: 12.2, z: 10.9 },
      { x: 14.8, z: 10.9 },
      { x: 14.8, z: 5.6 },
      { x: 12.2, z: 5.6 },
    ],
    speed: 0.35,
    bubble: "Welcome to Zedu HQ 👋",
  },
  {
    id: "sam",
    name: "Sam Okoro",
    username: "sam",
    role: "Frontend Engineer",
    status: "away",
    roomId: "lobby",
    position: { x: 21, z: 25 },
    avatar: { tint: "#e5e7eb", body: "a", outfit: "hoodie", accessory: "none" },
    waypoints: [
      { x: 19, z: 25 },
      { x: 34, z: 25 },
    ],
    speed: 0.3,
  },
  {
    id: "zoe",
    name: "Zoe",
    username: "zoe",
    role: "Contributor Assistant",
    status: "online",
    roomId: "reception",
    position: { x: 8.5, z: 3.2 },
    avatar: { tint: "#f4c46a", body: "b", outfit: "lab", accessory: "none" },
    isZoe: true,
  },
];

export const DEMO_LAYOUTS: Record<string, FurnitureItem[]> = {
  "personal:you": [
    { id: "you-rug", catalogId: "rug", x: 52.4, z: 29.4, rotation: 0 },
    { id: "you-desk", catalogId: "desk_oak", x: 52.4, z: 31.6, rotation: 0 },
    { id: "you-chair", catalogId: "chair_ergo", x: 52.4, z: 30.4, rotation: 0 },
    { id: "you-plant", catalogId: "plant", x: 50.2, z: 25.8, rotation: 0 },
    { id: "you-shelf", catalogId: "shelf", x: 54.7, z: 26.2, rotation: 270 },
    { id: "you-sofa", catalogId: "sofa", x: 54.2, z: 33.4, rotation: 180 },
    { id: "you-lamp", catalogId: "lamp", x: 50.2, z: 33.4, rotation: 0 },
  ],
  "personal:ada": [
    { id: "ada-rug", catalogId: "rug", x: 52.4, z: 12.4, rotation: 0 },
    { id: "ada-desk", catalogId: "desk_oak", x: 52.4, z: 14.8, rotation: 0 },
    { id: "ada-chair", catalogId: "chair_ergo", x: 52.4, z: 13.6, rotation: 0 },
    { id: "ada-plant", catalogId: "plant", x: 50.2, z: 10.1, rotation: 0 },
    { id: "ada-shelf", catalogId: "shelf", x: 54.7, z: 10.1, rotation: 270 },
  ],
  "personal:tunde": [
    { id: "tunde-rug", catalogId: "rug", x: 52.4, z: 20.4, rotation: 0 },
    { id: "tunde-desk", catalogId: "desk_oak", x: 52.4, z: 22.8, rotation: 0 },
    {
      id: "tunde-chair",
      catalogId: "chair_ergo",
      x: 52.4,
      z: 21.6,
      rotation: 0,
    },
    { id: "tunde-plant", catalogId: "plant", x: 54.7, z: 22.8, rotation: 0 },
    { id: "tunde-shelf", catalogId: "shelf", x: 50.2, z: 18.2, rotation: 270 },
  ],
  "channel:general": [
    { id: "gen-rug", catalogId: "rug", x: 6.5, z: 30.2, rotation: 0 },
  ],
  "channel:design": [
    { id: "design-rug", catalogId: "rug", x: 17.5, z: 30.2, rotation: 0 },
    {
      id: "design-whiteboard",
      catalogId: "whiteboard",
      x: 21.4,
      z: 27.5,
      rotation: 0,
    },
  ],
  "channel:dev": [
    { id: "dev-rug", catalogId: "rug", x: 28.5, z: 30.2, rotation: 0 },
    { id: "dev-screen", catalogId: "screen", x: 32.3, z: 27.6, rotation: 0 },
  ],
  "channel:marketing": [],
  lounge: [],
  reception: [],
  "meeting:1": [],
  "meeting:2": [],
};

export const CHAT_SEEDS: Record<string, ChatMessage[]> = {
  "channel:general": [
    {
      id: "g1",
      roomId: "channel:general",
      userId: "maya",
      name: "Maya Eze",
      text: "Morning! Standup notes are in the doc — we're demoing The Office at 4.",
      at: Date.now() - 1000 * 60 * 38,
    },
    {
      id: "g2",
      roomId: "channel:general",
      userId: "tunde",
      name: "Tunde Bello",
      text: "API deploy is green. Presence is writing through to the 2D app too.",
      at: Date.now() - 1000 * 60 * 31,
    },
    {
      id: "g3",
      roomId: "channel:general",
      userId: "ada",
      name: "Ada Obi",
      text: "New onboarding screens are in Figma. The purple accent looks unreal in 3D.",
      at: Date.now() - 1000 * 60 * 24,
    },
    {
      id: "g4",
      roomId: "channel:general",
      userId: "nia",
      name: "Nia Hart",
      text: "Reminder: pilot org gets the flag after the 5pm smoke. 🚀",
      at: Date.now() - 1000 * 60 * 12,
    },
  ],
  "channel:design": [
    {
      id: "d1",
      roomId: "channel:design",
      userId: "ada",
      name: "Ada Obi",
      text: "I moved the Office entry into the sidebar. It sits right under Home.",
      at: Date.now() - 1000 * 60 * 21,
    },
    {
      id: "d2",
      roomId: "channel:design",
      userId: "leo",
      name: "Leo Adeyemi",
      text: "The room labels are so much easier to read at a distance now.",
      at: Date.now() - 1000 * 60 * 9,
    },
  ],
  "channel:dev": [
    {
      id: "v1",
      roomId: "channel:dev",
      userId: "tunde",
      name: "Tunde Bello",
      text: "Position updates are 10Hz on desktop, 5Hz on mobile. Collision is server-validated.",
      at: Date.now() - 1000 * 60 * 17,
    },
    {
      id: "v2",
      roomId: "channel:dev",
      userId: "sam",
      name: "Sam Okoro",
      text: "Click-to-move feels good. The A* path cancels the moment you touch WASD.",
      at: Date.now() - 1000 * 60 * 6,
    },
  ],
  "channel:marketing": [
    {
      id: "m1",
      roomId: "channel:marketing",
      userId: "leo",
      name: "Leo Adeyemi",
      text: "Launch thread draft is ready for review.",
      at: Date.now() - 1000 * 60 * 45,
    },
  ],
  lounge: [
    {
      id: "l1",
      roomId: "lounge",
      userId: "leo",
      name: "Leo Adeyemi",
      text: "Coffee run before the demo? ☕",
      at: Date.now() - 1000 * 60 * 8,
    },
    {
      id: "l2",
      roomId: "lounge",
      userId: "nia",
      name: "Nia Hart",
      text: "Bringing pastries. Meet by the plants.",
      at: Date.now() - 1000 * 60 * 4,
    },
  ],
  reception: [
    {
      id: "r1",
      roomId: "reception",
      userId: "nia",
      name: "Nia Hart",
      text: "Welcome to Zedu HQ 👋 Zoe's at the desk if you need anything.",
      at: Date.now() - 1000 * 60 * 2,
    },
    {
      id: "r2",
      roomId: "reception",
      userId: "zoe",
      name: "Zoe",
      text: "Hi! Walk up to my desk and press E. I can help with tasks, deadlines and where to start.",
      at: Date.now() - 1000 * 60 * 1,
    },
  ],
  "personal:you": [
    {
      id: "p1",
      roomId: "personal:you",
      userId: "ada",
      name: "Ada Obi",
      text: "Your office is coming together. The oak desk was a good call.",
      at: Date.now() - 1000 * 60 * 14,
    },
  ],
  "meeting:1": [
    {
      id: "me1",
      roomId: "meeting:1",
      userId: "maya",
      name: "Maya Eze",
      text: "Buzz call starts in 2. Join when you're in the room.",
      at: Date.now() - 1000 * 60 * 5,
    },
  ],
  "meeting:2": [
    {
      id: "me2",
      roomId: "meeting:2",
      userId: "sam",
      name: "Sam Okoro",
      text: "Pairing on the layout validator here after lunch.",
      at: Date.now() - 1000 * 60 * 26,
    },
  ],
};

export const ZOE_QUICK_CHIPS = [
  "My tasks",
  "Team status",
  "Deadlines",
  "How do I build?",
];

export const ZOE_GREETING =
  "Hi — I'm Zoe, your Zedu contributor assistant. I'm right here in the building now. Ask me about your tasks, the team, deadlines, or how anything in Zedu works.";

export function zoeAnswer(question: string, roomName: string): string {
  const q = question.toLowerCase();

  if (q.includes("task") || q.includes("todo") || q.includes("work on")) {
    return `You have three tasks in flight this week:\n\n1. Finish the office bootstrap contract with Tunde — due today.\n2. Review Ada's onboarding screens — due tomorrow.\n3. Write the pilot-org smoke checklist with Nia — due Friday.\n\nYou're currently in ${roomName}. Want me to point you to the people who can unblock each one?`;
  }

  if (q.includes("team") || q.includes("status") || q.includes("who")) {
    return "Right now: Ada is in #design, Tunde is in #dev, Maya is on a Buzz call in Meeting A, Leo is in the lounge and Ife is heads-down in Focus 02. Nia is at reception. Everyone else is offline or away.\n\nMaya's call is the only status that's also visible in the 2D app.";
  }

  if (q.includes("deadline") || q.includes("due") || q.includes("when")) {
    return "The sprint ends Friday. The hard checkpoints are:\n\n• Today, 15:30 — code freeze for the demo build.\n• Today, 17:00 — pilot org gets the office flag.\n• Friday — 20-user room test and the rollback drill.\n\nI'd protect the rollback drill. It's the only release gate that can't be fixed after the fact.";
  }

  if (q.includes("build") || q.includes("furniture") || q.includes("edit")) {
    return "Walk into your private office in the west wing, then press B — or use the Furnish button. Click a catalog item, click the floor to place it, press R to rotate and Delete to remove it.\n\nPersonal offices autosave about half a second after you stop moving things. Shared rooms use an admin draft → publish flow so the whole building updates at once.";
  }

  if (q.includes("room") || q.includes("where") || q.includes("office")) {
    return `You're in ${roomName}. Channel rooms mirror the Zedu channels you're already in — the messages are the same messages. Private offices mirror DMs: the owner furnishes, DM participants visit read-only.\n\nTry the directory on the left, or click any room on the minimap to jump there.`;
  }

  if (q.includes("zoe") || q.includes("who are you") || q.includes("help")) {
    return "I'm Zoe. In this sprint I'm proxied to contributor-helper through a server-only service token, with your Zedu identity attached server-side. Later I move inside Zedu and keep the same request/response contract, so this UI won't change.\n\nI can see which room you're in and who's nearby — never the contents of private rooms.";
  }

  return `I couldn't find that in the knowledge base yet. I'd rather say that than invent an answer.\n\nTry asking about your tasks, the team's status, deadlines, or how the office maps to channels and DMs. You're in ${roomName} right now.`;
}

export function formatTime(at: number): string {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));
}

export function roomAt(x: number, z: number): OfficeRoom | null {
  for (const room of ROOMS) {
    const b = room.bounds;
    if (x >= b.x && x <= b.x + b.w && z >= b.z && z <= b.z + b.d) {
      return room;
    }
  }
  return null;
}

export function furnitureFootprint(
  catalogId: string,
  rotation: number
): { w: number; d: number } {
  const item = CATALOG_BY_ID[catalogId];
  if (!item) return { w: 1, d: 1 };
  return rotation % 180 === 0
    ? { w: item.footprint.w, d: item.footprint.d }
    : { w: item.footprint.d, d: item.footprint.w };
}

export function furnitureAabb(item: FurnitureItem): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const fp = furnitureFootprint(item.catalogId, item.rotation);
  return {
    minX: item.x - fp.w / 2,
    maxX: item.x + fp.w / 2,
    minZ: item.z - fp.d / 2,
    maxZ: item.z + fp.d / 2,
  };
}

export function validatePlacement(
  items: FurnitureItem[],
  catalogId: string,
  x: number,
  z: number,
  rotation: number,
  room: OfficeRoom
): string | null {
  const catalog = CATALOG_BY_ID[catalogId];
  if (!catalog) return "Unknown item.";
  if (!catalog.rotatable && rotation !== 0) rotation = 0;

  const fp = furnitureFootprint(catalogId, rotation);
  const minX = x - fp.w / 2;
  const maxX = x + fp.w / 2;
  const minZ = z - fp.d / 2;
  const maxZ = z + fp.d / 2;
  const pad = 0.15;

  if (
    minX < room.bounds.x + pad ||
    maxX > room.bounds.x + room.bounds.w - pad ||
    minZ < room.bounds.z + pad ||
    maxZ > room.bounds.z + room.bounds.d - pad
  ) {
    return "That would cross the room wall.";
  }

  // Door tiles are reserved so a room can never be sealed.
  const reserved = [
    {
      minX: room.door.x - 1.2,
      maxX: room.door.x + 1.2,
      minZ: room.door.z - 1.2,
      maxZ: room.door.z + 1.2,
    },
  ];
  for (const area of reserved) {
    if (
      minX < area.maxX &&
      maxX > area.minX &&
      minZ < area.maxZ &&
      maxZ > area.minZ
    ) {
      return "That spot is reserved for the doorway.";
    }
  }

  const sameType = items.filter((item) => item.catalogId === catalogId).length;
  if (sameType >= catalog.maxPerRoom) {
    return `You can only place ${catalog.maxPerRoom} of these.`;
  }

  for (const item of items) {
    if (!CATALOG_BY_ID[item.catalogId]?.collision) continue;
    const other = furnitureAabb(item);
    if (
      minX < other.maxX &&
      maxX > other.minX &&
      minZ < other.maxZ &&
      maxZ > other.minZ
    ) {
      return "That overlaps something already in the room.";
    }
  }

  return null;
}

/**
 * Everyone in `roomId` except the requester. Presence carries the requester's
 * own record, so the HUD, the room directory and Zoe all have to drop it or
 * the user is counted (and described) as a second person.
 */
export function othersInRoom<T extends { id: string; roomId: string }>(
  presence: T[],
  roomId: string | null,
  selfId: string
): T[] {
  if (!roomId) return [];
  return presence.filter(
    (point) => point.roomId === roomId && point.id !== selfId
  );
}

export function nearbyUsers(
  users: DemoUser[],
  roomId: string,
  x: number,
  z: number,
  radius = 10
): DemoUser[] {
  return users
    .filter((user) => user.roomId === roomId)
    .filter(
      (user) => Math.hypot(user.position.x - x, user.position.z - z) <= radius
    )
    .sort(
      (a, b) =>
        Math.hypot(a.position.x - x, a.position.z - z) -
        Math.hypot(b.position.x - x, b.position.z - z)
    );
}

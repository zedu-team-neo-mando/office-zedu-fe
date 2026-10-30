/**
 * Shared schema for The Office (3D virtual office).
 *
 * Mirrors the backend DTOs in office-zedu-be/internal/models/office.go and the
 * PRD (section 6.1). The API is two dimensional (x, y) while the scene works
 * in three dimensions (x, z), so the live source converts y to z on the way
 * in and back again on the way out.
 */

import type {
  FurnitureItem as SceneFurnitureItem,
  OfficeRoom as SceneRoom,
  PresenceStatus as ScenePresenceStatus,
} from "~/app/office/_components/office-data";

export type OfficeRoomKind = SceneRoom["kind"];
export type OfficePresenceStatus = ScenePresenceStatus;

/** Whether the realtime roster for the current room is connected yet. */
export type OfficePresenceState = "connecting" | "live";

/**
 * A room in the building. The scene contract lives in
 * src/app/office/_components/office-data.ts; the office API returns the same
 * rooms in its own shape and the live source maps them onto the floor plan.
 */
export type OfficeRoom = SceneRoom;

/** A piece of furniture. The API stores it as x/y, the scene uses x/z. */
export type OfficeFurnitureItem = SceneFurnitureItem;

export interface OfficeAvatarConfig {
  tint: string;
  body: "a" | "b" | "c";
  outfit: "casual" | "smart" | "hoodie" | "lab";
  accessory: "none" | "headphones" | "glasses" | "cap";
}

export interface OfficeBounds {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface OfficeGrid {
  width: number;
  height: number;
  tile: number;
}

export interface OfficeLayout {
  roomId: string;
  version: number;
  status?: string;
  grid: OfficeGrid;
  items: OfficeFurnitureItem[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface OfficeBuilding {
  id: string;
  orgId: string;
  name: string;
}

/**
 * One storey of the tower. Index 0 is the general floor, which sits above the
 * member floors and holds every channel in the organisation.
 */
export interface OfficeFloor {
  index: number;
  kind: "general" | "member";
  name: string;
  capacity: number;
  members: number;
  hasPortal: boolean;
}

/** A room exactly as the office API returns it (two dimensional). */
export interface OfficeApiRoom {
  id: string;
  kind: OfficeRoomKind;
  name: string;
  refId?: string;
  capacity: number;
  isLocked: boolean;
  floorIndex?: number;
  bounds: { x: number; y: number; w: number; h: number };
}

/** A furniture item exactly as the office API stores it. */
export interface OfficeApiItem {
  id: string;
  catalogId: string;
  x: number;
  y: number;
  rotation: number;
  variant?: string;
}

export interface OfficeApiLayout {
  roomId: string;
  version: number;
  status?: string;
  grid: OfficeGrid;
  items: OfficeApiItem[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface OfficeSettings {
  enabled: boolean;
}

/**
 * One person in the organisation's office directory. The tower draws every
 * member's office from this roster, whether or not the requester may walk
 * into that particular office.
 */
export interface OfficeMember {
  userId: string;
  displayName: string;
  username?: string;
  title?: string;
  avatarUrl?: string;
  tint?: string;
  role?: string;
  floorIndex: number;
  roomId: string;
  online: boolean;
  status: OfficePresenceStatus;
  statusText?: string;
  canVisit: boolean;
}

export interface OfficeBootstrap {
  building: OfficeBuilding;
  settings: OfficeSettings;
  floors: OfficeFloor[];
  members?: OfficeMember[];
  rooms: OfficeApiRoom[];
  layouts: Record<string, OfficeApiLayout>;
  channelRoomMap: Record<string, string>;
  dmOfficeMap: Record<string, string>;
}

export interface OfficeOccupant {
  userId: string;
  displayName: string;
  username: string;
  avatar: OfficeAvatarConfig;
  roomId: string;
  status: OfficePresenceStatus;
  position: { x: number; y: number; z: number };
  rotation: number;
  updatedAt: string;
}

export interface OfficeAccess {
  canEnter: boolean;
  canEditFurniture: boolean;
  canPublish: boolean;
  canReset: boolean;
}

export interface OfficeZoeContext {
  room: { id: string; kind: OfficeRoomKind; name: string };
  nearbyUsers: Array<{ displayName: string; status: OfficePresenceStatus }>;
}

/**
 * Everything the office scene needs from the outside world. The demo
 * implementation reads seeded data and localStorage, the live implementation
 * talks to the office API and Centrifugo. The 3D engine never changes.
 */
export interface OfficeSource {
  /** Human readable name of the environment, shown in the HUD. */
  readonly mode: "demo" | "live";
  /** The tower directory: the general floor first, then the member floors. */
  readonly floors: OfficeFloor[];
  /** Everyone in the organisation, with the office each one sits in. */
  readonly members: OfficeMember[];
  readonly rooms: OfficeRoom[];
  readonly initialLayouts: Record<string, OfficeFurnitureItem[]>;
  readonly initialMessages: Record<string, OfficeChatMessage[]>;
  readonly initialAvatar: OfficeAvatarConfig;

  loadLayouts(): Promise<Record<string, OfficeFurnitureItem[]>>;
  saveLayout(roomId: string, items: OfficeFurnitureItem[]): Promise<void>;
  publishLayout(roomId: string, items: OfficeFurnitureItem[]): Promise<void>;
  resetLayout(roomId: string): Promise<OfficeFurnitureItem[]>;
  saveAvatar(avatar: OfficeAvatarConfig): Promise<void>;
  sendMessage(roomId: string, text: string): Promise<OfficeChatMessage[]>;
  askZoe(question: string, context: OfficeZoeContext): Promise<string>;
  enterRoom(roomId: string): Promise<void>;
  leaveRoom(roomId: string): Promise<void>;
  /**
   * Publishes the local avatar's pose to the room it stands in. The HTTP
   * status comes back untouched, so the caller can answer `409 not_in_room`
   * or a `429` without another layer of toasts.
   */
  sendPosition(
    roomId: string,
    x: number,
    z: number,
    yaw: number
  ): Promise<number>;
  /** Who is standing in a room right now, for the first frame of presence. */
  fetchOccupants(roomId: string): Promise<OfficeOccupant[]>;
  subscribePresence(
    roomId: string,
    onPresence: (occupants: OfficeOccupant[]) => void,
    onState?: (state: OfficePresenceState) => void
  ): () => void;
  /**
   * The conversation a room mirrors, oldest first. Reading a room from the
   * street must show what is already in it, not only what arrives next.
   */
  fetchMessages(roomId: string): Promise<OfficeChatMessage[]>;
  /** Messages other people post into a room while it is being read. */
  subscribeMessages(
    roomId: string,
    onMessage: (message: OfficeChatMessage) => void
  ): () => void;
}

/** Chat message shape shared by both sources. */
export interface OfficeChatMessage {
  id: string;
  roomId: string;
  userId: string;
  name: string;
  text: string;
  at: number;
  self?: boolean;
  system?: boolean;
}

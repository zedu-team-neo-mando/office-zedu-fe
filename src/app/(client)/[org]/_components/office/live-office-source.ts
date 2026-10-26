"use client";

import { GetRequest, PostRequest, PutRequest } from "~/utils/new-request";
import {
  getSharedCentrifuge,
  getSubscriptionToken,
  prepareChannelSubscription,
  releaseChannelSubscription,
} from "~/lib/centrifugo/shared-centrifuge";
import type {
  OfficeApiItem,
  OfficeApiRoom,
  OfficeAvatarConfig,
  OfficeBootstrap,
  OfficeChatMessage,
  OfficeFloor,
  OfficeFurnitureItem,
  OfficeMember,
  OfficeOccupant,
  OfficePresenceState,
  OfficePresenceStatus,
  OfficeRoom,
  OfficeSource,
  OfficeZoeContext,
} from "~/types/office";
import {
  AVATAR_TINTS,
  CHANNEL_PALETTES,
  ROOMS,
} from "~/app/office/_components/office-data";
import { normalizeMediaUrl, uiAvatarUrl } from "~/lib/env-urls";

/** The API speaks two dimensions, the scene works in three. */
function toSceneItem(item: OfficeApiItem): OfficeFurnitureItem {
  return {
    id: item.id,
    catalogId: item.catalogId,
    x: item.x,
    z: item.y,
    rotation: (item.rotation as OfficeFurnitureItem["rotation"]) ?? 0,
    variant: item.variant,
  };
}

function toApiItem(item: OfficeFurnitureItem) {
  return {
    id: item.id,
    catalogId: item.catalogId,
    x: item.x,
    y: item.z,
    rotation: item.rotation,
    variant: item.variant,
  };
}

function encodeRoomId(roomId: string) {
  return encodeURIComponent(roomId);
}

function presenceChannel(orgId: string, floorIndex: number, roomId: string) {
  // Colons are forbidden: Centrifugo resolves the namespace before the first
  // `:`, and an undeclared namespace fails with `102: unknown channel`.
  // Base64url-encode the room ID so characters like `:` and `/` are safe.
  const bytes = new TextEncoder().encode(roomId);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const encoded = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `office_org_${orgId}_floor_${floorIndex}_room_${encoded}_presence`;
}

/**
 * The request helpers resolve with the error instead of throwing, so failures
 * are turned into an exception the office can show.
 */
function unwrap<T>(response: any, fallback: string): T {
  const status = response?.status;
  if (typeof status !== "number" || status >= 400) {
    throw new Error(response?.data?.message ?? fallback);
  }
  return response?.data?.data as T;
}

/** A row as the 2D chat's thread endpoints return it; the office reads a few fields. */
interface RawChatRow {
  thread_id?: string;
  user_id?: string;
  username?: string;
  full_name?: string;
  message?: string;
  created_at?: string;
  type?: string;
}

/**
 * The 2D chat stores its threads as rich-text HTML. The office drawer draws
 * plain text, so the markup is dropped here: block ends become line breaks and
 * the entities the editor wrote back (`&lt;`, `&amp;`) are read as the
 * characters they stand for.
 */
function plainText(value: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };

  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/gi, (match) => {
      return entities[match.toLowerCase()] ?? match;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toOfficeMessage(
  roomId: string,
  row: RawChatRow,
  selfId: string
): OfficeChatMessage | null {
  const text = typeof row?.message === "string" ? plainText(row.message) : "";
  // A row with no text is an attachment or an edited-away body: the office
  // drawer has no media renderer, so it is dropped rather than drawn empty.
  if (!row?.thread_id || !text) return null;

  const at = Date.parse(row.created_at ?? "");
  return {
    id: row.thread_id,
    roomId,
    userId: row.user_id ?? "",
    name: row.username ?? row.full_name ?? "Someone",
    text,
    at: Number.isNaN(at) ? Date.now() : at,
    self: row.user_id === selfId,
  };
}

/**
 * Reads a server sent events answer into one string. The helper may stream
 * deltas or one final chunk, so every payload shape contributes its text.
 */
async function readEventStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";

  const take = (payload: string) => {
    if (!payload || payload === "[DONE]") return;
    try {
      const parsed = JSON.parse(payload) as {
        delta?: string;
        text?: string;
        content?: string;
        answer?: string;
      };
      answer +=
        parsed.delta ?? parsed.text ?? parsed.content ?? parsed.answer ?? "";
    } catch {
      answer += payload;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) {
        take(trimmed.slice("data:".length).trim());
      }
    }
  }

  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    take(tail.slice("data:".length).trim());
  }

  return answer.trim();
}

/**
 * Neutral scene for the per-floor extras the server derives (a visitors area,
 * open pods, a game area). Only the palette is used; name and footprint come
 * from the API.
 */
const AREA_FALLBACK_ROOM: OfficeRoom = {
  id: "area:0:area",
  kind: "area",
  name: "Area",
  shortName: "Area",
  capacity: 12,
  locked: false,
  floorIndex: 0,
  accent: "#8b5cf6",
  floor: "#1b2030",
  bounds: { x: 0, z: 0, w: 7, d: 6 },
  description: "A shared corner of this floor.",
  spawn: { x: 3, z: 3 },
  door: { x: 3, z: 6 },
  chat: true,
};

/**
 * The building's floor plan is fixed; the rooms inside it are real. Each real
 * room takes the next free slot of its kind, so the organisation's own
 * channels and people end up in the rooms a visitor would expect.
 *
 * Room bounds come from the API (OfficeApiRoom.bounds), which is the source
 * of truth. The static ROOMS slots are only used for description and fallback
 * capacity when the API doesn't provide one.
 */
function buildRooms(
  apiRooms: OfficeApiRoom[],
  joinedChannelIds?: Set<string>
): OfficeRoom[] {
  const slots: Record<string, OfficeRoom[]> = {
    channel: ROOMS.filter((room) => room.kind === "channel"),
    personal: ROOMS.filter((room) => room.kind === "personal"),
    meeting: ROOMS.filter((room) => room.kind === "meeting"),
    focus: ROOMS.filter((room) => room.kind === "focus"),
    lobby: ROOMS.filter((room) => room.kind === "lobby"),
    reception: ROOMS.filter((room) => room.kind === "reception"),
    lounge: ROOMS.filter((room) => room.kind === "lounge"),
  };

  const used: Record<string, number> = {};
  const rooms: OfficeRoom[] = [];
  let northRoomCount = 0;
  let floor0NorthX = 2.4;
  let floor1NorthX = 2.4;
  let channelCount = 0;
  let memberOfficeCount = 0;

  for (const room of apiRooms) {
    const isExcluded =
      room.kind !== "focus" &&
      (room.kind === "area" ||
        room.id.startsWith("area:") ||
        /pod|visitor|game/i.test(room.name || "") ||
        /pod|visitor|game/i.test(room.id || "") ||
        /teammate/i.test(room.name || "") ||
        /teammate/i.test(room.id || "") ||
        Boolean(
          (room as any).shortName && /teammate/i.test((room as any).shortName)
        ));
    if (isExcluded) continue;

    const kind = room.kind as keyof typeof slots;
    const available = slots[kind] ?? [];
    const index = used[kind] ?? 0;
    used[kind] = index + 1;

    const slot = available[index] ?? available[available.length - 1];
    const template = slot;
    if (!template && kind !== "channel") continue;

    let f = room.floorIndex ?? 0;

    let bounds: { x: number; z: number; w: number; d: number };
    let door: { x: number; z: number };
    let spawn: { x: number; z: number };
    let accent = template?.accent ?? "#60a5fa";
    let floorColor = template?.floor ?? "#172536";

    if (room.kind === "channel") {
      const chIdx = channelCount++;
      const chFloor = Math.floor(chIdx / 6);
      const col = chIdx % 6;
      f = chFloor;
      bounds = {
        x: 2.4 + col * 7.2,
        z: 13.2,
        w: 7.2,
        d: 6.4,
      };
      door = { x: bounds.x + 3.6, z: 13.2 };
      spawn = { x: bounds.x + 3.6, z: 14.6 };
      const pal = CHANNEL_PALETTES[col % CHANNEL_PALETTES.length];
      accent = pal.accent;
      floorColor = pal.floor;
    } else if (room.kind === "personal") {
      const pIdx = memberOfficeCount++;
      const floorOffset = Math.floor(pIdx / 12);
      f = 2 + floorOffset;
      const idxOnFloor = pIdx % 12;
      const row = idxOnFloor % 2;
      const col = Math.floor(idxOnFloor / 2);
      const w = 5.0;
      const d = 4.8;
      bounds = {
        x: 2.4 + col * w,
        z: row === 0 ? 2.4 : 10.4,
        w,
        d,
      };
      door = { x: bounds.x + w / 2, z: row === 0 ? 7.2 : 10.4 };
      spawn = { x: bounds.x + w / 2, z: row === 0 ? 6.0 : 11.6 };
      if (template?.accent) accent = template.accent;
      if (template?.floor) floorColor = template.floor;
    } else {
      // Shared North suites (reception, lounge, meeting, focus) - max 6 in a row per floor
      const nIdx = northRoomCount++;
      const nFloor = Math.floor(nIdx / 6);
      f = nFloor;
      const w = template?.bounds?.w ?? 7.2;
      const d = template?.bounds?.d ?? 6.4;
      const currentX = f === 0 ? floor0NorthX : floor1NorthX;
      bounds = {
        x: currentX,
        z: 2.4,
        w,
        d,
      };
      if (f === 0) {
        floor0NorthX += w;
      } else {
        floor1NorthX += w;
      }
      door = { x: bounds.x + w / 2, z: 8.8 };
      spawn = { x: bounds.x + w / 2, z: 6.8 };
      if (template?.accent) accent = template.accent;
      if (template?.floor) floorColor = template.floor;
    }

    const rawName = room.name || "Room";
    const displayName =
      room.kind === "channel" && !rawName.startsWith("#")
        ? `#${rawName}`
        : rawName;

    let isLocked = Boolean(room.isLocked);
    let description = template?.description || `The ${displayName} space.`;

    if (room.kind === "channel") {
      const chRefId = String(room.refId || room.id.replace(/^channel:/, ""));
      const isJoined = joinedChannelIds ? joinedChannelIds.has(chRefId) : false;
      if (joinedChannelIds && joinedChannelIds.size > 0) {
        isLocked = !isJoined;
      }
      if (isLocked) {
        description = `You are not a member of ${displayName}. Join the channel in Zedu to enter.`;
      }
    }

    rooms.push({
      ...(template || {}),
      id: room.id,
      name: displayName,
      shortName: displayName,
      kind: room.kind,
      refId: room.refId,
      capacity: room.capacity || template?.capacity || 30,
      locked: isLocked,
      // Only a channel or a DM-backed private office has a conversation.
      // Shared spaces keep their 2D description instead of an empty chat.
      chat: room.kind === "channel" || room.kind === "personal",
      description,
      ownerId: room.refId,
      floorIndex: f,
      accent,
      floor: floorColor,
      bounds,
      spawn,
      door,
    });
  }

  return rooms;
}

/**
 * Raised when the organisation has switched the office off while the user
 * was in it. The route sends them back to the organisation landing.
 */
export class OfficeDisabledError extends Error {
  constructor() {
    super("The office is switched off for this organisation.");
    this.name = "OfficeDisabledError";
  }
}

function deriveMemberTint(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TINTS[hash % AVATAR_TINTS.length] ?? "#8b5cf6";
}

function resolveMemberName(raw: any, user?: any, fallback = ""): string {
  const fullName = [
    user?.first_name,
    user?.last_name,
    raw?.first_name,
    raw?.last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const name =
    raw?.displayName ||
    raw?.display_name ||
    raw?.name ||
    user?.display_name ||
    user?.displayName ||
    user?.name ||
    fullName ||
    user?.username ||
    raw?.username ||
    user?.fullname ||
    user?.full_name ||
    (typeof user?.email === "string" ? user.email.split("@")[0] : "") ||
    (typeof raw?.email === "string" ? raw.email.split("@")[0] : "") ||
    fallback;
  if (/teammate/i.test(name)) {
    return "";
  }
  return name;
}

interface CanonicalUserRecord {
  canonicalId: string;
  user: any;
  displayName: string;
  aliases: Set<string>;
}

function registerCanonicalUser(
  u: any,
  canonicalUsers: Map<string, CanonicalUserRecord>,
  aliasToCanonical: Map<string, string>,
  selfId?: string,
  isSelf = false
) {
  if (!u) return;

  const rawId = u.id !== undefined && u.id !== null ? String(u.id) : "";
  const rawUserId = u.user_id ? String(u.user_id) : "";
  const username = u.username ? String(u.username) : "";
  const email = typeof u.email === "string" ? u.email.toLowerCase().trim() : "";

  const matchesSelf =
    isSelf ||
    (Boolean(selfId) &&
      (selfId === rawId || selfId === rawUserId || selfId === username));

  let canonicalId =
    (matchesSelf && selfId) ||
    (rawUserId ? aliasToCanonical.get(rawUserId) : undefined) ||
    (rawId ? aliasToCanonical.get(rawId) : undefined) ||
    (email ? aliasToCanonical.get(email) : undefined) ||
    (username ? aliasToCanonical.get(username) : undefined);

  if (!canonicalId) {
    canonicalId =
      matchesSelf && selfId ? selfId : rawUserId || rawId || username;
  }
  if (!canonicalId) return;

  let record = canonicalUsers.get(canonicalId);
  if (!record) {
    const displayName = resolveMemberName(undefined, u, "");
    record = {
      canonicalId,
      user: u,
      displayName,
      aliases: new Set<string>(),
    };
    canonicalUsers.set(canonicalId, record);
  } else {
    record.user = { ...record.user, ...u };
    if (!record.displayName) {
      record.displayName = resolveMemberName(undefined, record.user, "");
    }
  }

  if (rawId) {
    record.aliases.add(rawId);
    aliasToCanonical.set(rawId, canonicalId);
  }
  if (rawUserId) {
    record.aliases.add(rawUserId);
    aliasToCanonical.set(rawUserId, canonicalId);
  }
  if (username) {
    record.aliases.add(username);
    aliasToCanonical.set(username, canonicalId);
  }
  if (email) {
    record.aliases.add(email);
    aliasToCanonical.set(email, canonicalId);
  }
  if (matchesSelf) {
    record.aliases.add("you");
    aliasToCanonical.set("you", canonicalId);
    if (selfId) {
      record.aliases.add(selfId);
      aliasToCanonical.set(selfId, canonicalId);
    }
  }
}

/**
 * The live office. Rooms come from the organisation's real channels, direct
 * messages and people; layouts come from the office API; presence arrives over
 * Centrifugo. Nothing here falls back to seeded data.
 */
export class LiveOfficeSource implements OfficeSource {
  readonly mode = "live" as const;

  floors: OfficeFloor[] = [];
  members: OfficeMember[] = [];
  rooms: OfficeRoom[] = [];
  initialLayouts: Record<string, OfficeFurnitureItem[]> = {};
  initialMessages: Record<string, OfficeChatMessage[]> = {};
  initialAvatar: OfficeAvatarConfig = {
    tint: "#8b5cf6",
    body: "b",
    outfit: "smart",
    accessory: "glasses",
  };

  private orgId = "";
  private userId = "";
  private currentUser?: any;
  private channelRoomMap: Record<string, string> = {};
  private dmOfficeMap: Record<string, string> = {};
  private dmRoomMap: Record<string, string> = {};
  private floorByRoom: Record<string, number> = {};
  private activeSubscription?: any;
  private activeRoomId?: string;
  private roomListeners = new Set<(rooms: OfficeRoom[]) => void>();
  private joinedChannelIds = new Set<string>();

  subscribeRooms(callback: (rooms: OfficeRoom[]) => void): () => void {
    this.roomListeners.add(callback);
    callback([...this.rooms]);
    return () => {
      this.roomListeners.delete(callback);
    };
  }

  private notifyRoomListeners() {
    for (const listener of this.roomListeners) {
      try {
        listener([...this.rooms]);
      } catch (err) {
        console.error("Room listener error", err);
      }
    }
  }

  setJoinedChannels(channels: any[]) {
    this.joinedChannelIds.clear();
    if (Array.isArray(channels)) {
      for (const ch of channels) {
        const id = String(ch?.id || ch?.channels_id || "");
        if (id) {
          this.joinedChannelIds.add(id);
        }
      }
    }
  }

  isChannelJoined(ch: any): boolean {
    const chId = String(ch?.id || ch?.channels_id || "");
    if (chId && this.joinedChannelIds.has(chId)) return true;
    if (ch?.access === true) return true;
    if (ch?.is_member === true || ch?.isMember === true) return true;
    if (ch?.is_joined === true || ch?.isJoined === true) return true;
    if (Array.isArray(ch?.members) && this.userId) {
      if (
        ch.members.some(
          (m: any) => String(m?.id || m?.user_id || m) === this.userId
        )
      ) {
        return true;
      }
    }
    return false;
  }

  syncJoinedChannels(joinedChannels?: any[]): boolean {
    if (Array.isArray(joinedChannels)) {
      for (const ch of joinedChannels) {
        const id = String(ch?.id || ch?.channels_id || "");
        if (id) {
          this.joinedChannelIds.add(id);
        }
      }
    }

    let changed = false;
    for (const room of this.rooms) {
      if (room.kind !== "channel") continue;
      const chId = String(room.refId || room.id.replace(/^channel:/, ""));
      const isJoined = this.joinedChannelIds.has(chId);
      const isLocked = !isJoined;
      const lockedDesc = `You are not a member of ${room.name}. Join the channel in Zedu to enter.`;
      if (room.locked !== isLocked) {
        room.locked = isLocked;
        if (isLocked) {
          room.description = lockedDesc;
        }
        changed = true;
      }
    }

    if (changed) {
      this.notifyRoomListeners();
    }
    return changed;
  }

  private ensureFloors() {
    const maxFloorIndex = Math.max(
      1,
      ...this.rooms.map((r) => r.floorIndex ?? 0)
    );
    const floors: OfficeFloor[] = [
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
    ];
    for (let f = 2; f <= maxFloorIndex; f++) {
      const memberCountOnFloor =
        this.members?.filter((m) => m.floorIndex === f).length ?? 0;
      floors.push({
        index: f,
        kind: "member",
        name: `Floor ${f - 1}`,
        capacity: 12,
        members: memberCountOnFloor,
        hasPortal: true,
      });
    }
    this.floors = floors;
  }

  syncChannels(channels: any[], joinedChannels?: any[]): boolean {
    if (Array.isArray(joinedChannels)) {
      for (const ch of joinedChannels) {
        const id = String(ch?.id || ch?.channels_id || "");
        if (id) {
          this.joinedChannelIds.add(id);
        }
      }
    }

    if (!Array.isArray(channels) || channels.length === 0) return false;

    let changed = false;
    const existingChannelIds = new Set(
      this.rooms
        .filter((r) => r.kind === "channel")
        .map((r) => String(r.refId || r.id.replace(/^channel:/, "")))
    );

    let totalChannelCount = this.rooms.filter(
      (r) => r.kind === "channel"
    ).length;

    for (const ch of channels) {
      const chId = String(ch.id || ch.channels_id || "");
      if (!chId) continue;

      const rawName = String(ch.name || ch.channel_name || "channel");
      const displayName = rawName.startsWith("#") ? rawName : `#${rawName}`;
      const roomId = `channel:${chId}`;
      const isJoined = this.isChannelJoined(ch);
      const isLocked = !isJoined;
      const lockedDescription = `You are not a member of ${displayName}. Join the channel in Zedu to enter.`;
      const description = isLocked
        ? lockedDescription
        : ch.description || `The ${displayName} channel.`;

      if (existingChannelIds.has(chId)) {
        const room = this.rooms.find(
          (r) =>
            r.kind === "channel" &&
            String(r.refId || r.id.replace(/^channel:/, "")) === chId
        );
        if (room) {
          if (
            room.name !== displayName ||
            room.locked !== isLocked ||
            room.description !== description
          ) {
            room.name = displayName;
            room.shortName = displayName;
            room.locked = isLocked;
            room.description = description;
            changed = true;
          }
        }
        continue;
      }

      existingChannelIds.add(chId);
      this.channelRoomMap[chId] = roomId;

      const chIdx = totalChannelCount++;
      const chFloor = Math.floor(chIdx / 6);
      const col = chIdx % 6;

      const bounds = {
        x: 2.4 + col * 7.2,
        z: 13.2,
        w: 7.2,
        d: 6.4,
      };
      const spawn = {
        x: bounds.x + 3.6,
        z: 16.0,
      };
      const door = {
        x: bounds.x + 3.6,
        z: 13.2,
      };

      const pal = CHANNEL_PALETTES[col % CHANNEL_PALETTES.length];

      this.rooms.push({
        id: roomId,
        kind: "channel",
        name: displayName,
        shortName: displayName,
        refId: chId,
        capacity: 30,
        locked: isLocked,
        chat: true,
        description,
        ownerId: chId,
        floorIndex: chFloor,
        accent: pal.accent,
        floor: pal.floor,
        bounds,
        spawn,
        door,
      });

      changed = true;
    }

    if (changed) {
      this.ensureFloors();
      this.notifyRoomListeners();
    }

    return changed;
  }

  async refreshChannels(): Promise<void> {
    if (!this.orgId) return;
    try {
      const [res, userRes] = await Promise.all([
        GetRequest(`/organisations/${this.orgId}/channels?limit=100`),
        GetRequest(`/organisations/${this.orgId}/user-channels`).catch(
          () => null
        ),
      ]);
      const userChannels = userRes?.data?.data;
      if (Array.isArray(userChannels)) {
        for (const ch of userChannels) {
          const id = String(ch?.id || ch?.channels_id || "");
          if (id) this.joinedChannelIds.add(id);
        }
      }
      const channels = res?.data?.data;
      if (Array.isArray(channels)) {
        this.syncChannels(channels);
      } else if (Array.isArray(userChannels)) {
        this.syncJoinedChannels();
      }
    } catch {
      // ignore background refresh errors
    }
  }

  async init(
    orgId: string,
    userId: string,
    context?: {
      currentUser?: any;
      orgMembers?: any[];
      channels?: any[];
      joinedChannels?: any[];
    }
  ) {
    this.orgId = orgId;
    this.userId = userId;
    this.currentUser = context?.currentUser;

    if (Array.isArray(context?.joinedChannels)) {
      for (const ch of context.joinedChannels) {
        const id = String(ch?.id || ch?.channels_id || "");
        if (id) this.joinedChannelIds.add(id);
      }
    }

    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem(`office_avatar_${userId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed.tint === "string") {
            this.initialAvatar = { ...this.initialAvatar, ...parsed };
          }
        }
      } catch {
        // ignore
      }
    }

    const [response, usersRes, channelsRes, userChannelsRes] =
      await Promise.all([
        GetRequest("/office/bootstrap"),
        GetRequest(`/organisations/${orgId}/users?limit=100`).catch(() => null),
        GetRequest(`/organisations/${orgId}/channels?limit=100`).catch(
          () => null
        ),
        GetRequest(`/organisations/${orgId}/user-channels`).catch(() => null),
      ]);
    const status = response?.status ?? response?.response?.status;

    if (status === 403) {
      throw new OfficeDisabledError();
    }

    const data = response?.data?.data as OfficeBootstrap | undefined;
    if (!data) {
      throw new Error(
        response?.data?.message ?? "The office could not be loaded right now."
      );
    }
    this.channelRoomMap = data.channelRoomMap ?? {};
    this.dmOfficeMap = data.dmOfficeMap ?? {};
    this.dmRoomMap = Object.fromEntries(
      Object.entries(this.dmOfficeMap).map(([dmChannelId, roomId]) => [
        roomId,
        dmChannelId,
      ])
    );

    const apiUserChannels = userChannelsRes?.data?.data;
    if (Array.isArray(apiUserChannels)) {
      for (const ch of apiUserChannels) {
        const id = String(ch?.id || ch?.channels_id || "");
        if (id) this.joinedChannelIds.add(id);
      }
    }

    this.rooms = buildRooms(data.rooms ?? [], this.joinedChannelIds);
    this.floors = data.floors ?? [];
    this.ensureFloors();

    const orgChannels = [
      ...(Array.isArray(context?.channels) ? context.channels : []),
      ...(Array.isArray(channelsRes?.data?.data) ? channelsRes.data.data : []),
    ];

    if (orgChannels.length > 0) {
      this.syncChannels(orgChannels);
    } else {
      this.syncJoinedChannels();
    }

    const canonicalUsers = new Map<string, CanonicalUserRecord>();
    const aliasToCanonical = new Map<string, string>();

    // 1. Current user first, so their canonicalId is guaranteed to be this.userId
    if (context?.currentUser) {
      registerCanonicalUser(
        context.currentUser,
        canonicalUsers,
        aliasToCanonical,
        this.userId,
        true
      );
    } else if (this.userId) {
      aliasToCanonical.set(this.userId, this.userId);
      aliasToCanonical.set("you", this.userId);
    }

    // 2. Org members from context
    if (Array.isArray(context?.orgMembers)) {
      for (const u of context.orgMembers) {
        registerCanonicalUser(u, canonicalUsers, aliasToCanonical, this.userId);
      }
    }

    // 3. Raw users from API
    const rawUsers = usersRes?.data?.data;
    if (Array.isArray(rawUsers)) {
      for (const u of rawUsers) {
        registerCanonicalUser(u, canonicalUsers, aliasToCanonical, this.userId);
      }
    }

    // Pass 1: Canonicalize any existing personal rooms in this.rooms
    for (const room of this.rooms) {
      if (room.kind !== "personal") continue;
      const ownerRef = String(
        room.ownerId || room.refId || room.id.replace(/^personal:/, "")
      );
      const isSelf = ownerRef === "you" || ownerRef === this.userId;
      const canonicalId = isSelf
        ? this.userId
        : aliasToCanonical.get(ownerRef) || ownerRef;

      const record = canonicalUsers.get(canonicalId);
      const displayName =
        record?.displayName ||
        (isSelf
          ? resolveMemberName(undefined, context?.currentUser, "You") || "You"
          : resolveMemberName(
              undefined,
              undefined,
              room.name && !/teammate/i.test(room.name)
                ? room.name.replace(/'s office$/i, "")
                : ""
            ));

      room.ownerId = canonicalId;
      room.refId = canonicalId;
      room.id = `personal:${canonicalId}`;
      if (
        displayName &&
        (!room.name || room.name === "Your office" || room.name === "Room")
      ) {
        room.name = `${displayName}'s office`;
        room.shortName = displayName;
      }
    }

    // Deduplicate personal rooms: keep at most one office per canonical user and per normalized name
    const seenPersonalOwners = new Set<string>();
    const seenPersonalNames = new Set<string>();
    this.rooms = this.rooms.filter((room) => {
      if (room.kind !== "personal") return true;
      const canonicalId = String(
        room.ownerId || room.refId || room.id.replace(/^personal:/, "")
      );
      const normName = (room.name || "")
        .toLowerCase()
        .replace(/'s office$/i, "")
        .replace(/ your office$/i, "")
        .trim();

      if (seenPersonalOwners.has(canonicalId)) return false;
      if (normName && seenPersonalNames.has(normName)) return false;

      seenPersonalOwners.add(canonicalId);
      if (normName) seenPersonalNames.add(normName);
      return true;
    });

    // Pass 2: Add missing personal offices for members in canonicalUsers
    let memberOfficeCount = this.rooms.filter(
      (r) => r.kind === "personal"
    ).length;
    for (const record of canonicalUsers.values()) {
      const uid = record.canonicalId;
      if (!uid || seenPersonalOwners.has(uid)) continue;
      const displayName = record.displayName;
      if (!displayName || /teammate/i.test(displayName)) continue;
      const normName = displayName.toLowerCase().trim();
      if (seenPersonalNames.has(normName)) continue;

      seenPersonalOwners.add(uid);
      seenPersonalNames.add(normName);

      const isOnline = Boolean(
        record.user?.online ||
        record.user?.status === "online" ||
        uid === this.userId
      );
      const roomId = `personal:${uid}`;
      const officeIndex = memberOfficeCount++;
      const floorOffset = Math.floor(officeIndex / 12);
      const memberFloor = 2 + floorOffset;
      const idxOnFloor = officeIndex % 12;
      const row = idxOnFloor % 2;
      const col = Math.floor(idxOnFloor / 2);
      const w = 5.0;
      const d = 4.8;
      const bounds = {
        x: 2.4 + col * w,
        z: row === 0 ? 2.4 : 10.4,
        w,
        d,
      };
      const door = {
        x: bounds.x + w / 2,
        z: row === 0 ? 7.2 : 10.4,
      };
      const spawn = {
        x: bounds.x + w / 2,
        z: row === 0 ? 6.0 : 11.6,
      };

      this.rooms.push({
        id: roomId,
        kind: "personal",
        name: `${displayName}'s office`,
        shortName: displayName,
        refId: uid,
        ownerId: uid,
        capacity: 4,
        locked: !isOnline,
        floorIndex: memberFloor,
        accent: deriveMemberTint(uid),
        floor: "carpet",
        bounds,
        description: isOnline
          ? `${displayName}'s office`
          : `${displayName} is offline. Private offices are locked while the owner is away.`,
        spawn,
        door,
        chat: true,
      });
    }

    // Build this.members roster
    if (data.members && data.members.length > 0) {
      const seenMemberIds = new Set<string>();
      const seenMemberNames = new Set<string>();
      this.members = [];
      for (const item of data.members) {
        const raw = item as any;
        const rawUid = String(raw.userId || raw.user_id || raw.id || "");
        const canonicalId =
          rawUid === "you" || rawUid === this.userId
            ? this.userId
            : aliasToCanonical.get(rawUid) || rawUid;
        if (!canonicalId || seenMemberIds.has(canonicalId)) continue;

        const record = canonicalUsers.get(canonicalId);
        const user = record?.user;
        const displayName = record?.displayName || resolveMemberName(raw, user);
        if (!displayName || /teammate/i.test(displayName)) continue;
        const normName = displayName.toLowerCase().trim();
        if (seenMemberNames.has(normName)) continue;

        seenMemberIds.add(canonicalId);
        seenMemberNames.add(normName);

        const targetRoomId = `personal:${canonicalId}`;
        const room = this.rooms.find(
          (r) => r.id === targetRoomId || r.ownerId === canonicalId
        );
        const isOnline = Boolean(
          raw.online ?? user?.online ?? canonicalId === this.userId
        );

        const avatarUrl = normalizeMediaUrl(
          raw.avatarUrl ||
            raw.avatar_url ||
            raw.default_avatar_url ||
            user?.avatar_url ||
            user?.default_avatar_url ||
            user?.profile_url ||
            uiAvatarUrl(displayName)
        );

        this.members.push({
          userId: canonicalId,
          displayName,
          username: raw.username || user?.username,
          title: raw.title || user?.role || "",
          avatarUrl,
          tint: raw.tint || deriveMemberTint(canonicalId),
          role: raw.role || user?.role,
          floorIndex:
            room?.floorIndex ?? raw.floorIndex ?? raw.floor_index ?? 2,
          roomId: room?.id || targetRoomId,
          online: isOnline,
          status: (raw.status ||
            (isOnline ? "online" : "away")) as OfficePresenceStatus,
          canVisit: raw.canVisit ?? raw.can_visit ?? true,
        });
      }
    } else {
      const memberList: OfficeMember[] = [];
      const seenMemberIds = new Set<string>();
      const seenMemberNames = new Set<string>();

      for (const room of this.rooms.filter((r) => r.kind === "personal")) {
        const canonicalId = String(
          room.ownerId || room.refId || room.id.replace(/^personal:/, "")
        );
        if (!canonicalId || seenMemberIds.has(canonicalId)) continue;

        const record = canonicalUsers.get(canonicalId);
        const user = record?.user;
        const displayName =
          record?.displayName ||
          resolveMemberName(
            undefined,
            user,
            room.name && !/teammate/i.test(room.name)
              ? room.name.replace(/'s office$/i, "")
              : ""
          );
        if (!displayName || /teammate/i.test(displayName)) continue;
        const normName = displayName.toLowerCase().trim();
        if (seenMemberNames.has(normName)) continue;

        seenMemberIds.add(canonicalId);
        seenMemberNames.add(normName);

        const isOnline = Boolean(user?.online || canonicalId === this.userId);
        room.locked = !isOnline;
        if (!isOnline) {
          room.description = `${displayName} is offline. Private offices are locked while the owner is away.`;
        }

        const avatarUrl = normalizeMediaUrl(
          user?.avatar_url ||
            user?.default_avatar_url ||
            user?.profile_url ||
            uiAvatarUrl(displayName)
        );

        memberList.push({
          userId: canonicalId,
          displayName,
          username: user?.username,
          title: user?.role,
          avatarUrl,
          tint: deriveMemberTint(canonicalId),
          role: user?.role,
          floorIndex: room.floorIndex ?? 2,
          roomId: room.id,
          online: isOnline,
          status: isOnline ? ("online" as const) : ("away" as const),
          canVisit: isOnline && !room.locked,
        });
      }

      this.members = memberList;
    }

    // Completely purge any area rooms or teammate rooms
    this.rooms = this.rooms.filter((room) => {
      if (room.kind === "area" || room.id.startsWith("area:")) return false;
      if (
        /pod|visitor|game/i.test(room.name) ||
        /pod|visitor|game/i.test(room.id)
      )
        return false;
      if (
        /teammate/i.test(room.name) ||
        /teammate/i.test(room.id) ||
        /teammate/i.test(room.shortName)
      )
        return false;
      return true;
    });

    // Re-index all rooms on member floors so they strictly have at most 6 rooms per row
    let personalRoomCount = 0;
    for (const room of this.rooms) {
      if (room.kind === "personal") {
        const pIdx = personalRoomCount++;
        const floorOffset = Math.floor(pIdx / 12);
        const f = 2 + floorOffset;
        const idx = pIdx % 12;
        const row = idx % 2;
        const col = Math.floor(idx / 2);
        const w = 5.0;
        const d = 4.8;
        room.floorIndex = f;
        room.bounds = {
          x: 2.4 + col * w,
          z: row === 0 ? 2.4 : 10.4,
          w,
          d,
        };
        room.door = {
          x: room.bounds.x + w / 2,
          z: row === 0 ? 7.2 : 10.4,
        };
        room.spawn = {
          x: room.bounds.x + w / 2,
          z: row === 0 ? 6.0 : 11.6,
        };
      }
    }

    if (this.members) {
      for (const member of this.members) {
        const room = this.rooms.find((r) => r.id === member.roomId);
        if (room && room.floorIndex !== undefined) {
          member.floorIndex = room.floorIndex;
        }
      }
    }

    this.ensureFloors();

    this.floorByRoom = Object.fromEntries(
      this.rooms.map((room) => [room.id, room.floorIndex ?? 0])
    );

    for (const [roomId, layout] of Object.entries(data.layouts ?? {})) {
      this.initialLayouts[roomId] = (layout.items ?? []).map(toSceneItem);
    }

    const avatarResponse = await GetRequest("/users/me/avatar");
    const avatar = avatarResponse?.data?.data as OfficeAvatarConfig | undefined;
    if (avatar?.tint) {
      this.initialAvatar = avatar;
    }
  }

  async loadLayouts() {
    return this.initialLayouts;
  }

  async saveLayout(roomId: string, items: OfficeFurnitureItem[]) {
    const payload = {
      grid: { width: 56, height: 36, tile: 1 },
      items: items.map(toApiItem),
    };

    this.initialLayouts[roomId] = items;

    try {
      const isPersonal = roomId.startsWith("personal:");
      if (isPersonal) {
        unwrap(
          await PutRequest(
            `/office/rooms/${encodeRoomId(roomId)}/layout`,
            payload
          ),
          "Your office could not be saved."
        );
        return;
      }

      unwrap(
        await PostRequest(
          `/office/rooms/${encodeRoomId(roomId)}/layout/draft`,
          payload
        ),
        "The draft could not be saved."
      );
    } catch {
      // Saved in local memory if room is not yet tracked on the backend
    }
  }

  async publishLayout(roomId: string, items: OfficeFurnitureItem[]) {
    // Load the current layout version first, so we can send it for optimistic
    // concurrency. The BE only conflicts when version > 0.
    const layoutResponse = await GetRequest(
      `/office/rooms/${encodeRoomId(roomId)}/layout`
    );
    let version = 0;
    if (layoutResponse?.data?.data?.version) {
      version = layoutResponse.data.data.version;
    }

    await this.saveLayout(roomId, items);
    unwrap(
      await PostRequest(
        `/office/rooms/${encodeRoomId(roomId)}/layout/publish`,
        { version }
      ),
      "The layout could not be published."
    );
    this.activeSubscription
      ?.publish({
        type: "layout_update",
        roomId,
        items,
      })
      .catch(() => {});
  }

  async resetLayout(roomId: string) {
    const layout = unwrap<{ items?: OfficeApiItem[] } | undefined>(
      await PostRequest(
        `/office/rooms/${encodeRoomId(roomId)}/layout/reset`,
        {}
      ),
      "The room could not be reset."
    );
    return (layout?.items ?? []).map(toSceneItem);
  }

  async saveAvatar(avatar: OfficeAvatarConfig) {
    this.initialAvatar = avatar;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(
          `office_avatar_${this.userId}`,
          JSON.stringify(avatar)
        );
      } catch {
        // ignore
      }
    }
    unwrap(
      await PutRequest("/users/me/avatar", avatar),
      "Your look could not be saved."
    );
  }

  async sendMessage(
    roomId: string,
    text: string
  ): Promise<OfficeChatMessage[]> {
    const channelId =
      this.channelIdForRoom(roomId) ??
      (await this.resolveChannelIdForRoom(roomId));
    if (!channelId) return [];

    // The office posts through the same endpoints the 2D chat uses. A new
    // top-level message is a new thread; replying to an existing thread is a
    // different route, which the office does not need.
    const threadId = crypto.randomUUID();
    const payload = {
      content: text,
      thread_id: threadId,
      media: [],
    };

    if (roomId.startsWith("channel:")) {
      unwrap(
        await PostRequest(`/threads/${channelId}`, payload),
        "The message was not sent."
      );
    } else if (roomId.startsWith("personal:")) {
      unwrap(
        await PostRequest(`/dms/channels/${channelId}/threads`, payload),
        "The message was not sent."
      );
    }

    return [];
  }

  async askZoe(question: string, context: OfficeZoeContext) {
    // Zoe is answered by the Next proxy route, which keeps the service token
    // on the server. The Go API has no /office/zoe endpoint.
    const token = localStorage.getItem("token") ?? "";
    const response = await fetch("/api/office/zoe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: question }],
        context: {
          location: "office",
          buildingId: this.orgId,
          room: context.room,
          nearbyUsers: context.nearbyUsers,
        },
      }),
    });

    if (!response.ok) {
      throw new Error("Zoe could not answer that right now.");
    }

    if (
      (response.headers.get("content-type") ?? "").includes("text/event-stream")
    ) {
      const streamed = await readEventStream(response);
      if (streamed.length > 0) {
        return streamed;
      }
      throw new Error("Zoe could not answer that right now.");
    }

    const payload = (await response.json().catch(() => null)) as {
      answer?: string;
      message?: string;
      data?: { answer?: string };
    } | null;
    const answer = payload?.data?.answer ?? payload?.answer ?? payload?.message;

    if (typeof answer === "string" && answer.length > 0) {
      return answer;
    }

    throw new Error("Zoe could not answer that right now.");
  }

  async enterRoom(roomId: string) {
    if (!roomId) return;
    try {
      const res = await PostRequest(
        `/office/rooms/${encodeRoomId(roomId)}/enter`,
        {}
      );
      unwrap(res, "The room could not be entered.");
    } catch {
      // Virtual or synthesized rooms not tracked in the backend database are safely ignored
    }
  }

  async leaveRoom(roomId: string) {
    if (!roomId) return;
    try {
      const res = await PostRequest(
        `/office/rooms/${encodeRoomId(roomId)}/leave`,
        {}
      );
      unwrap(res, "The room could not be left.");
    } catch {
      // Virtual or synthesized rooms not tracked in the backend database are safely ignored
    }
  }

  async fetchOccupants(roomId: string): Promise<OfficeOccupant[]> {
    if (!roomId) return [];
    try {
      const response = await GetRequest(
        `/office/rooms/${encodeRoomId(roomId)}/occupants`
      );

      return (
        unwrap<OfficeOccupant[] | undefined>(
          response,
          "The room could not be read."
        ) ?? []
      );
    } catch {
      return [];
    }
  }

  private roster = new Map<string, OfficeOccupant>();

  publishPresence(roomId: string, update: Partial<OfficeOccupant>): void {
    if (
      !this.activeSubscription ||
      this.activeSubscription.state !== "subscribed" ||
      this.activeRoomId !== roomId
    ) {
      return;
    }

    const displayName =
      this.currentUser?.display_name ||
      [this.currentUser?.first_name, this.currentUser?.last_name]
        .filter(Boolean)
        .join(" ") ||
      this.currentUser?.name ||
      this.currentUser?.username ||
      "Colleague";

    const pos = update.position as any;
    const posX = pos?.x ?? 0;
    const posZ = pos?.z ?? pos?.y ?? 0;

    const payload = {
      type: "update",
      presence: {
        userId: this.userId,
        roomId,
        displayName,
        username: this.currentUser?.username ?? "",
        avatar: this.initialAvatar,
        status: (update.status ?? "online") as OfficePresenceStatus,
        ...update,
        position: { x: posX, y: posZ, z: posZ },
        rotation: update.rotation ?? 0,
        updatedAt: new Date().toISOString(),
      },
    };

    this.activeSubscription.publish(payload).catch(() => {
      // Drop transient transport failures
    });
  }

  subscribePresence(
    roomId: string,
    onPresence: (occupants: OfficeOccupant[]) => void,
    onState?: (state: OfficePresenceState) => void,
    onLayoutUpdate?: (roomId: string, items: OfficeFurnitureItem[]) => void
  ): () => void {
    const client = getSharedCentrifuge();
    // Presence is published per room, so the subscription has to be for the
    // room the user is standing in. The backend only signs a token for a
    // room it knows, so a made-up room id would be refused.
    const channel = presenceChannel(
      this.orgId,
      this.floorByRoom[roomId] ?? 0,
      roomId
    );
    const subscription = prepareChannelSubscription(client, channel, {
      getToken: () => getSubscriptionToken(channel),
    });

    this.activeSubscription = subscription;
    this.activeRoomId = roomId;

    // Seed the roster once from the REST snapshot, so people who were already
    // in the room survive the first realtime event.
    this.roster.clear();
    onState?.("connecting");
    let cancelled = false;
    void this.fetchOccupants(roomId)
      .then((occupants) => {
        if (cancelled) return;
        for (const occupant of occupants) {
          this.roster.set(occupant.userId, occupant);
        }
        onPresence([...this.roster.values()]);
      })
      .catch(() => {
        // The subscription still delivers everyone who arrives later.
      });

    const onPublication = (ctx: any) => {
      const eventType = ctx?.data?.type as string | undefined;

      if (eventType === "layout_update") {
        const payloadRoomId = ctx?.data?.roomId as string | undefined;
        const payloadItems = ctx?.data?.items as
          | OfficeFurnitureItem[]
          | undefined;
        if (payloadRoomId && Array.isArray(payloadItems)) {
          onLayoutUpdate?.(payloadRoomId, payloadItems);
        }
        return;
      }

      const presence = ctx?.data?.presence as OfficeOccupant | undefined;
      if (!presence) return;

      if (eventType === "leave") {
        this.roster.delete(presence.userId);
      } else {
        const existing = this.roster.get(presence.userId);
        const merged = existing ? { ...existing, ...presence } : presence;
        this.roster.set(presence.userId, merged);
      }

      // Emit the complete roster so the UI never has stale entries.
      onPresence([...this.roster.values()]);
    };

    const onSubscribed = () => onState?.("live");
    const onUnsubscribed = () => onState?.("connecting");

    subscription.on("publication", onPublication);
    subscription.on("subscribed", onSubscribed);
    subscription.on("unsubscribed", onUnsubscribed);
    // A shared subscription may already be live from another room.
    if (subscription.state === "subscribed") onState?.("live");
    subscription.subscribe();

    return () => {
      cancelled = true;
      if (this.activeRoomId === roomId) {
        this.activeSubscription = undefined;
        this.activeRoomId = undefined;
      }
      subscription.off("publication", onPublication);
      subscription.off("subscribed", onSubscribed);
      subscription.off("unsubscribed", onUnsubscribed);
      releaseChannelSubscription(client, channel, subscription);
      // Clear the roster for this room so a subsequent subscription starts clean.
      this.roster.clear();
    };
  }

  async fetchMessages(roomId: string): Promise<OfficeChatMessage[]> {
    const room = this.rooms.find((candidate) => candidate.id === roomId);
    // A locked office is visible in the tower but its conversation is not.
    if (room?.locked) return [];
    const channelId =
      this.channelIdForRoom(roomId) ??
      (await this.resolveChannelIdForRoom(roomId));
    if (!channelId) return [];

    // The office reads the conversation the 2D chat already draws: channel
    // threads for a channel room, DM threads for the office that mirrors a DM.
    const path = roomId.startsWith("channel:")
      ? `/threads/channels/${channelId}?page=1&limit=40`
      : `/dms/channels/${channelId}/threads?page=1&limit=50`;
    const rows =
      unwrap<RawChatRow[]>(
        await GetRequest(path),
        "The conversation could not be read."
      ) ?? [];

    return rows
      .map((row) => toOfficeMessage(roomId, row, this.userId))
      .filter((message): message is OfficeChatMessage => Boolean(message))
      .sort((a, b) => a.at - b.at);
  }

  subscribeMessages(
    roomId: string,
    onMessage: (message: OfficeChatMessage) => void
  ): () => void {
    const room = this.rooms.find((candidate) => candidate.id === roomId);
    if (room?.locked) return () => {};

    let activeUnsub: (() => void) | null = null;
    let cancelled = false;

    const setup = (channelId: string) => {
      const client = getSharedCentrifuge();
      const subscription = prepareChannelSubscription(client, channelId, {
        getToken: () => getSubscriptionToken(channelId),
      });

      const onPublication = (ctx: any) => {
        if (ctx?.data?.type !== "message") return;
        const message = toOfficeMessage(roomId, ctx.data, this.userId);
        if (!message || message.self) return;
        onMessage(message);
      };

      subscription.on("publication", onPublication);
      subscription.subscribe();

      return () => {
        subscription.off("publication", onPublication);
        releaseChannelSubscription(client, channelId, subscription);
      };
    };

    const immediateChannelId = this.channelIdForRoom(roomId);
    if (immediateChannelId) {
      activeUnsub = setup(immediateChannelId);
    } else {
      void this.resolveChannelIdForRoom(roomId).then((resolved) => {
        if (!cancelled && resolved) {
          activeUnsub = setup(resolved);
        }
      });
    }

    return () => {
      cancelled = true;
      activeUnsub?.();
    };
  }

  async refreshMembers(): Promise<OfficeMember[]> {
    if (!this.orgId) return this.members;
    try {
      const [response, usersRes] = await Promise.all([
        GetRequest("/office/bootstrap").catch(() => null),
        GetRequest(`/organisations/${this.orgId}/users?limit=100`).catch(
          () => null
        ),
      ]);
      const data = response?.data?.data as OfficeBootstrap | undefined;
      const rawUsers = usersRes?.data?.data;
      if (data?.members && data.members.length > 0) {
        const canonicalUsers = new Map<string, CanonicalUserRecord>();
        const aliasToCanonical = new Map<string, string>();

        if (this.currentUser) {
          registerCanonicalUser(
            this.currentUser,
            canonicalUsers,
            aliasToCanonical,
            this.userId,
            true
          );
        } else if (this.userId) {
          aliasToCanonical.set(this.userId, this.userId);
          aliasToCanonical.set("you", this.userId);
        }

        if (Array.isArray(rawUsers)) {
          for (const u of rawUsers) {
            registerCanonicalUser(
              u,
              canonicalUsers,
              aliasToCanonical,
              this.userId
            );
          }
        }

        const seenMemberIds = new Set<string>();
        const seenMemberNames = new Set<string>();
        const updatedMembers: OfficeMember[] = [];

        for (const item of data.members) {
          const raw = item as any;
          const rawUid = String(raw.userId || raw.user_id || raw.id || "");
          const canonicalId =
            rawUid === "you" || rawUid === this.userId
              ? this.userId
              : aliasToCanonical.get(rawUid) || rawUid;
          if (!canonicalId || seenMemberIds.has(canonicalId)) continue;

          const record = canonicalUsers.get(canonicalId);
          const user = record?.user;
          const displayName =
            record?.displayName || resolveMemberName(raw, user);
          if (!displayName || /teammate/i.test(displayName)) continue;
          const normName = displayName.toLowerCase().trim();
          if (seenMemberNames.has(normName)) continue;

          seenMemberIds.add(canonicalId);
          seenMemberNames.add(normName);

          const targetRoomId = `personal:${canonicalId}`;
          const room = this.rooms.find(
            (r) => r.id === targetRoomId || r.ownerId === canonicalId
          );
          const isOnline = Boolean(
            raw.online ||
            user?.status === "online" ||
            user?.online ||
            canonicalId === this.userId
          );

          const avatarUrl = normalizeMediaUrl(
            raw.avatarUrl ||
              raw.avatar_url ||
              raw.default_avatar_url ||
              user?.avatar_url ||
              user?.default_avatar_url ||
              user?.profile_url ||
              uiAvatarUrl(displayName)
          );

          updatedMembers.push({
            userId: canonicalId,
            displayName,
            username: raw.username || user?.username,
            title: raw.title || user?.role || "",
            avatarUrl,
            tint: raw.tint || deriveMemberTint(canonicalId),
            floorIndex:
              room?.floorIndex ?? raw.floorIndex ?? raw.floor_index ?? 2,
            roomId: room?.id || targetRoomId,
            online: isOnline,
            status: (raw.status ||
              (isOnline ? "online" : "away")) as OfficePresenceStatus,
            canVisit: raw.canVisit !== false,
            role: raw.role || user?.role,
          });
        }

        if (updatedMembers.length > 0) {
          this.members = updatedMembers;
        }
      }
    } catch {
      // drop transient errors
    }
    return this.members;
  }

  /** The conversation behind a room, if it has one. */
  private channelIdForRoom(roomId: string): string | null {
    if (roomId.startsWith("channel:")) {
      return roomId.slice("channel:".length);
    }
    if (roomId.startsWith("personal:")) {
      return this.dmRoomMap[roomId] ?? null;
    }
    return null;
  }

  /** Resolves or creates a DM channel if not yet cached in dmRoomMap. */
  private async resolveChannelIdForRoom(
    roomId: string
  ): Promise<string | null> {
    if (roomId.startsWith("channel:")) {
      return roomId.slice("channel:".length);
    }
    if (roomId.startsWith("personal:")) {
      if (this.dmRoomMap[roomId]) return this.dmRoomMap[roomId];
      const targetUserId = roomId.replace(/^personal:/, "");
      if (!this.orgId || !targetUserId) return null;
      try {
        const res = await PostRequest(`/organisations/${this.orgId}/dms`, {
          chat_type: "user",
          participant_id: targetUserId,
        });
        const channelId =
          res?.data?.data?.channel_id ||
          res?.data?.data?.id ||
          res?.data?.channel_id;
        if (channelId) {
          this.dmRoomMap[roomId] = String(channelId);
          return String(channelId);
        }
      } catch {
        // drop transient error
      }
      return null;
    }
    return null;
  }
}

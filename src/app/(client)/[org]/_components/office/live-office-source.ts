"use client";

import {
  BuzzRequest,
  GetRequest,
  PostRequest,
  PutRequest,
} from "~/utils/new-request";
import {
  getSharedCentrifuge,
  getSubscriptionToken,
  prepareChannelSubscription,
  releaseChannelSubscription,
} from "~/lib/centrifugo/shared-centrifuge";
import { createZoeRequest } from "~/lib/zoe/request-contract";
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
  OfficeRoom,
  OfficeSource,
  OfficeZoeContext,
} from "~/types/office";
import { ROOMS } from "~/app/office/_components/office-data";
import { entryErrorFromResponse } from "~/app/office/_components/office-entry";
import {
  ownsPersonalOffice,
  personalOfficeTemplate,
  withPersonalOfficeDefaults,
} from "~/app/office/_components/office-layout";

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

export function normalizeOccupant(
  raw: any,
  roomId: string
): OfficeOccupant | null {
  if (!raw || typeof raw !== "object") return null;
  const userId = String(raw.userId || raw.user_id || raw.id || "");
  if (!userId) return null;

  const rawPos = raw.position || raw.pos || {};
  const x = Number(rawPos.x ?? 0);
  const z = Number(rawPos.z ?? rawPos.y ?? 0);
  const y = Number(rawPos.z !== undefined ? (rawPos.y ?? 0) : 0);

  const rawAvatar = raw.avatar || raw.avatar_config || {};

  return {
    userId,
    displayName:
      raw.displayName ||
      raw.display_name ||
      raw.username ||
      raw.name ||
      "Colleague",
    username: raw.username || raw.user_name || "",
    avatar: {
      tint: rawAvatar.tint || raw.tint || "#8b5cf6",
      body: rawAvatar.body || "b",
      outfit: rawAvatar.outfit || "smart",
      accessory: rawAvatar.accessory || "none",
    },
    roomId: raw.roomId || raw.room_id || roomId,
    status: raw.status || "online",
    position: { x, y, z },
    rotation: Number(raw.rotation ?? raw.yaw ?? 0),
    updatedAt: raw.updatedAt || raw.updated_at || new Date().toISOString(),
  };
}

/**
 * Whether the incoming record is older than the one already held. A record
 * whose timestamp cannot be read is never considered older, so a snapshot can
 * only erase live publication state when it can prove it predates it.
 */
function isOlderOccupant(incoming: OfficeOccupant, held: OfficeOccupant) {
  const at = Date.parse(incoming.updatedAt ?? "");
  const heldAt = Date.parse(held.updatedAt ?? "");
  if (Number.isNaN(at) || Number.isNaN(heldAt)) return false;
  return at < heldAt;
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
    system: row.type === "system",
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
 * A portal is a doorway, not a place to sit: it carries no chat and no
 * presence, only the storey it joins. Bounds still come from the API.
 */
const PORTAL_FALLBACK_ROOM: OfficeRoom = {
  id: "portal:0",
  kind: "portal",
  name: "Portal",
  shortName: "Portal",
  capacity: 0,
  locked: false,
  floorIndex: 0,
  accent: "#a78bfa",
  floor: "#241d39",
  bounds: { x: 0, z: 0, w: 4, d: 4 },
  description: "The door between the channels floor and the private floors.",
  spawn: { x: 2, z: 1 },
  door: { x: 2, z: 0 },
  chat: false,
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
  dmRoomMap: Record<string, string>
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

  for (const room of apiRooms) {
    const kind = room.kind as keyof typeof slots;
    const available = slots[kind] ?? [];
    const index = used[kind] ?? 0;
    used[kind] = index + 1;

    const slot = available[index] ?? available[available.length - 1];

    // The per-floor extras and the portals are not seeded scenes: the API owns
    // their name and footprint, so they fall back to a neutral template and
    // derive the walk-in point from the bounds the server sends.
    const template =
      slot ??
      (room.kind === "area"
        ? { ...AREA_FALLBACK_ROOM }
        : room.kind === "portal"
          ? { ...PORTAL_FALLBACK_ROOM }
          : undefined);
    if (!template) continue;

    // Bounds come from the API (source of truth), in two dimensions. Convert
    // them to the scene's x/z plane.
    const bounds = room.bounds
      ? {
          x: room.bounds.x,
          z: room.bounds.y,
          w: room.bounds.w,
          d: room.bounds.h,
        }
      : template.bounds;

    // The server lays the rooms out, so the walk-in point follows every
    // footprint. The demo's static spawns only make sense on the demo plan.
    // A portal opens north, towards the floor it serves; every other room opens
    // south, onto its corridor.
    const isPortal = room.kind === "portal";
    const spawn = isPortal
      ? {
          x: bounds.x + bounds.w / 2,
          z: bounds.z + Math.min(1.8, bounds.d * 0.35),
        }
      : {
          x: bounds.x + bounds.w / 2,
          z: bounds.z + bounds.d - Math.min(1.6, bounds.d * 0.35),
        };
    const door = isPortal
      ? { x: bounds.x + bounds.w / 2, z: bounds.z }
      : { x: bounds.x + bounds.w / 2, z: bounds.z + bounds.d };

    rooms.push({
      ...template,
      id: room.id,
      name: room.name,
      shortName: room.name,
      kind: room.kind,
      refId: room.refId,
      capacity: room.capacity || template.capacity,
      locked: Boolean(room.isLocked),
      // Only a channel or a DM-backed private office has a conversation.
      // Shared spaces keep their 2D description instead of an empty chat.
      chat:
        room.kind === "channel" ||
        (room.kind === "personal" && Boolean(dmRoomMap[room.id])),
      description: template.description,
      ownerId: room.refId,
      floorIndex: room.floorIndex ?? 0,
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
  private channelRoomMap: Record<string, string> = {};
  private dmOfficeMap: Record<string, string> = {};
  private dmRoomMap: Record<string, string> = {};
  /** Conversations being started right now, so a double click makes one DM. */
  private openingConversations = new Map<string, Promise<OfficeRoom | null>>();
  private floorByRoom: Record<string, number> = {};
  private selfName = "Colleague";
  /** The room presence subscription that is open right now, if any. */
  private presenceSubscription: any = null;
  private presenceRoomId: string | null = null;
  /** Live door channels, by floor, so the owner's change reaches each one. */
  private doorSubscriptions = new Map<number, any>();
  /** Everyone listening for doors in this tab, so a change shows at once. */
  private doorListeners = new Set<(roomId: string, open: boolean) => void>();
  /**
   * The rooms the server has admitted this user to. Entry requests for two
   * rooms can overlap, so each room's admission is kept on its own: a late
   * answer for one room never clears another.
   */
  private admittedRooms = new Set<string>();
  private lastPose: {
    roomId: string;
    x: number;
    z: number;
    yaw: number;
  } | null = null;

  async init(orgId: string, userId: string, selfName?: string) {
    this.orgId = orgId;
    this.userId = userId;
    if (selfName) this.selfName = selfName;

    const response = await GetRequest("/office/bootstrap");
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

    this.rooms = buildRooms(data.rooms ?? [], this.dmRoomMap);
    this.floors = data.floors ?? [];
    // The member roster is what makes the tower a directory of people rather
    // than a row of anonymous offices. A bootstrap from an older backend has
    // no roster, so the rooms themselves are used as a fallback.
    this.members =
      data.members && data.members.length > 0
        ? data.members
        : this.rooms
            .filter((room) => room.kind === "personal")
            .map((room) => ({
              userId: room.refId ?? room.id,
              displayName: room.name,
              floorIndex: room.floorIndex ?? 0,
              roomId: room.id,
              online: false,
              status: "away" as const,
              canVisit: !room.locked,
            }));
    this.floorByRoom = Object.fromEntries(
      (data.rooms ?? []).map((room) => [room.id, room.floorIndex ?? 0])
    );

    for (const [roomId, layout] of Object.entries(data.layouts ?? {})) {
      this.initialLayouts[roomId] = (layout.items ?? []).map((item) => ({
        ...toSceneItem(item),
        roomId,
      }));
    }
    this.initialLayouts = withPersonalOfficeDefaults(
      this.rooms,
      this.initialLayouts
    );

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
  }

  async resetLayout(roomId: string) {
    const room = this.rooms.find((candidate) => candidate.id === roomId);
    if (room && ownsPersonalOffice(room, this.userId)) {
      const defaults = personalOfficeTemplate(room);
      await this.saveLayout(roomId, defaults);
      return defaults;
    }

    const layout = unwrap<{ items?: OfficeApiItem[] } | undefined>(
      await PostRequest(
        `/office/rooms/${encodeRoomId(roomId)}/layout/reset`,
        {}
      ),
      "The room could not be reset."
    );
    return (layout?.items ?? []).map((item) => ({
      ...toSceneItem(item),
      roomId,
    }));
  }

  async saveAvatar(avatar: OfficeAvatarConfig) {
    unwrap(
      await PutRequest("/users/me/avatar", avatar),
      "Your look could not be saved."
    );
  }

  async sendMessage(
    roomId: string,
    text: string
  ): Promise<OfficeChatMessage[]> {
    const channelId = this.channelIdForRoom(roomId);
    if (!channelId) {
      throw new Error(
        "This office has no linked conversation. Open a DM in Zedu, then reload Office."
      );
    }

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

    return [
      {
        id: threadId,
        roomId,
        userId: this.userId,
        name:
          this.members.find((member) => member.userId === this.userId)
            ?.displayName ?? "You",
        text,
        at: Date.now(),
        self: true,
      },
    ];
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
      body: JSON.stringify(createZoeRequest(question, context, this.orgId)),
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

  /**
   * Asks the server to let this user into a room. The server owns the
   * decision, so nothing is published to the room until it says yes: a
   * refused visitor (a full Focus pod, a locked office) is never announced as
   * standing inside, and the refusal is thrown for the office to act on.
   */
  async enterRoom(roomId: string) {
    // The silent helper hands the refusal back instead of toasting it, so the
    // office can say once, in its own words, why the door stayed shut.
    const response = await BuzzRequest(
      `/office/rooms/${encodeRoomId(roomId)}/enter`,
      {}
    );
    const refusal = entryErrorFromResponse(response, roomId);
    if (refusal) {
      this.admittedRooms.delete(roomId);
      throw refusal;
    }
    this.admittedRooms.add(roomId);
    this.publishOverSocket(roomId, "join");
  }

  async leaveRoom(roomId: string) {
    this.publishOverSocket(roomId, "leave");
    this.admittedRooms.delete(roomId);
    unwrap(
      await PostRequest(`/office/rooms/${encodeRoomId(roomId)}/leave`, {}),
      "The room could not be left."
    );
  }

  async sendPosition(
    roomId: string,
    x: number,
    z: number,
    yaw: number
  ): Promise<number> {
    this.lastPose = { roomId, x, z, yaw };
    // Everyone subscribed to the room hears the move straight away over the
    // realtime channel; the REST call below only keeps the server's snapshot
    // fresh for people who arrive later.
    const published = this.publishOverSocket(roomId, "update");

    // Movement goes out several times a second, so it uses the silent request
    // helper: a refused attempt (409, 429 or a network blip) must not raise a
    // toast, it only hands its status back to the caller to back off with.
    const response = await BuzzRequest(
      `/office/rooms/${encodeRoomId(roomId)}/presence`,
      { position: { x, y: 0, z }, rotation: yaw }
    );
    const status = response?.status ?? response?.response?.status;
    if (published) return 200;
    // No answer at all: 0 tells the caller to back off and try again later.
    return typeof status === "number" ? status : 0;
  }

  /**
   * Publishes this user's presence on the room channel the client is
   * subscribed to. Returns false when that room's subscription is not live,
   * or when the server has not admitted this user to the room: being able to
   * read a room's roster is not the same as standing in it.
   */
  private publishOverSocket(
    roomId: string,
    type: "join" | "update" | "leave"
  ): boolean {
    const subscription = this.presenceSubscription;
    if (
      !this.admittedRooms.has(roomId) ||
      !subscription ||
      this.presenceRoomId !== roomId ||
      subscription.state !== "subscribed"
    ) {
      return false;
    }
    const pose = this.lastPose?.roomId === roomId ? this.lastPose : null;
    const spawn = this.rooms.find((room) => room.id === roomId)?.spawn;
    const x = pose?.x ?? spawn?.x ?? 8.5;
    const z = pose?.z ?? spawn?.z ?? 9.4;
    subscription
      .publish({
        type,
        presence: {
          userId: this.userId,
          roomId,
          displayName: this.selfName,
          username: this.selfName,
          avatar: this.initialAvatar,
          status: "online",
          position: { x, y: 0, z },
          rotation: pose?.yaw ?? Math.PI,
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => {
        // A dropped frame is replaced by the next one a moment later.
      });
    return true;
  }

  async fetchOccupants(roomId: string): Promise<OfficeOccupant[]> {
    // Centrifugo only carries what happens after a subscription, so the room
    // is read once to fill in the people who were already standing there.
    const response = await GetRequest(
      `/office/rooms/${encodeRoomId(roomId)}/occupants`
    );

    const data = unwrap<any[] | { occupants?: any[] } | undefined>(
      response,
      "The room could not be read."
    );
    const list = Array.isArray(data) ? data : (data?.occupants ?? []);
    return list
      .map((item) => normalizeOccupant(item, roomId))
      .filter((occ): occ is OfficeOccupant => Boolean(occ));
  }

  subscribePresence(
    roomId: string,
    onPresence: (occupants: OfficeOccupant[]) => void,
    onState?: (state: OfficePresenceState) => void
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
    this.presenceSubscription = subscription;
    this.presenceRoomId = roomId;

    let cancelled = false;
    /**
     * The roster belongs to this subscription and to no other: two rooms can
     * never mix their people, and closing one room cannot empty another. It is
     * only ever replaced whole, never cleared first, so a snapshot landing
     * late cannot make the avatars disappear in between.
     */
    let roster = new Map<string, OfficeOccupant>();
    /** Raised on every resync, so a snapshot an older one requested is dropped. */
    let syncGeneration = 0;
    /**
     * What the stream carried while a snapshot was being read: a join or a
     * departure that happened after the snapshot was taken.
     */
    let inFlight: {
      left: Set<string>;
      upserts: Map<string, OfficeOccupant>;
    } | null = null;

    const emit = () => onPresence([...roster.values()]);

    /** A record only overwrites the one held when it is not provably older. */
    const apply = (
      target: Map<string, OfficeOccupant>,
      occupant: OfficeOccupant
    ) => {
      const held = target.get(occupant.userId);
      if (held && isOlderOccupant(occupant, held)) return false;
      target.set(occupant.userId, occupant);
      return true;
    };

    // The stream only carries what happens from the subscription onwards, so
    // the room is read each time the subscription goes live: on the first
    // join and after every reconnect alike, because publications missed while
    // the connection was down cannot be recovered any other way.
    const resync = () => {
      const generation = ++syncGeneration;
      const ticket = {
        left: new Set<string>(),
        upserts: new Map<string, OfficeOccupant>(),
      };
      inFlight = ticket;

      void this.fetchOccupants(roomId)
        .then((occupants) => {
          // A newer resync or a teardown owns the roster now.
          if (cancelled || generation !== syncGeneration) return;
          if (inFlight === ticket) inFlight = null;

          // The snapshot and the stream are folded into a new map that is
          // swapped in one step, so nobody is missing while it is rebuilt.
          const next = new Map<string, OfficeOccupant>(roster);
          for (const leftId of ticket.left) {
            next.delete(leftId);
          }
          for (const occupant of occupants) {
            // A departure the stream already carried is newer than this
            // snapshot, so that person is not brought back from it.
            if (ticket.left.has(occupant.userId)) continue;
            const held = next.get(occupant.userId);
            if (held && isOlderOccupant(occupant, held)) continue;
            next.set(occupant.userId, occupant);
          }
          for (const [userId, occupant] of ticket.upserts) {
            const held = next.get(userId);
            if (held && isOlderOccupant(occupant, held)) continue;
            next.set(userId, occupant);
          }
          roster = next;
          emit();
        })
        .catch(() => {
          // The subscription still delivers everyone who arrives later.
          if (inFlight === ticket) inFlight = null;
        });
    };

    const onPublication = (ctx: any) => {
      const data = ctx?.data;
      if (!data) return;

      const eventType = data?.type || data?.event;
      if (eventType === "query") {
        if (!data?.senderId || data.senderId !== this.userId) {
          this.publishOverSocket(roomId, "update");
        }
        return;
      }

      const rawPresence =
        data?.presence ||
        data?.occupant ||
        data?.data ||
        (data?.userId || data?.user_id ? data : undefined);
      if (!rawPresence) return;

      const presence = normalizeOccupant(rawPresence, roomId);
      if (!presence) return;

      if (eventType === "leave" || data?.action === "leave") {
        roster.delete(presence.userId);
        inFlight?.upserts.delete(presence.userId);
        inFlight?.left.add(presence.userId);
      } else {
        inFlight?.left.delete(presence.userId);
        // Only a record that actually took hold has to survive the snapshot.
        if (apply(roster, presence))
          inFlight?.upserts.set(presence.userId, presence);
        // Whenever a peer announces a join (e.g. after refreshing), reply with
        // an update so they see us immediately without us having to move.
        if (eventType === "join" && presence.userId !== this.userId) {
          this.publishOverSocket(roomId, "update");
        }
      }

      // Emit the complete roster so the UI never has stale entries.
      emit();
    };

    const onSubscribed = () => {
      // Going live (the first time or after a reconnect) is the moment to
      // read the room again: it holds everyone the stream did not carry.
      onState?.("live");
      resync();
      // Only a reconnect re-announces this avatar; a first subscription is
      // still waiting on the server to admit it, and publishOverSocket stays
      // quiet until then.
      this.publishOverSocket(roomId, "join");
      subscription
        .publish({ type: "query", roomId, senderId: this.userId })
        .catch(() => {});
    };
    const onUnsubscribed = () => onState?.("connecting");

    subscription.on("publication", onPublication);
    subscription.on("subscribed", onSubscribed);
    subscription.on("unsubscribed", onUnsubscribed);
    onState?.("connecting");
    // A shared subscription may already be live from another room.
    if (subscription.state === "subscribed") onSubscribed();
    subscription.subscribe();

    return () => {
      cancelled = true;
      syncGeneration++;
      // Tell the room this avatar is gone before the channel is released.
      this.publishOverSocket(roomId, "leave");
      if (this.presenceSubscription === subscription) {
        this.presenceSubscription = null;
        this.presenceRoomId = null;
      }
      subscription.off("publication", onPublication);
      subscription.off("subscribed", onSubscribed);
      subscription.off("unsubscribed", onUnsubscribed);
      releaseChannelSubscription(client, channel, subscription);
      // The roster dies with the subscription it belongs to, so the next room
      // starts from its own snapshot instead of inheriting this one.
    };
  }

  private doorKey(roomId: string) {
    return `office_door_${this.orgId}_${roomId}`;
  }

  /** The owner's own door state, remembered in this browser. */
  private readOwnDoor(roomId: string): boolean | null {
    try {
      const stored = localStorage.getItem(this.doorKey(roomId));
      return stored === "closed" ? false : stored === "open" ? true : null;
    } catch {
      return null;
    }
  }

  /** The offices this user owns on a storey. */
  private ownOfficesOn(floorIndex: number) {
    return this.rooms.filter(
      (room) =>
        (room.floorIndex ?? 0) === floorIndex &&
        ownsPersonalOffice(room, this.userId)
    );
  }

  /**
   * The storey's shared room (reception, lobby or open area), whose channel
   * everyone on the floor can hear. Door changes travel on it because people
   * in the corridor are not subscribed to the office they are looking at.
   */
  private floorCommonRoomId(floorIndex: number): string | null {
    const onFloor = this.rooms.filter(
      (room) => (room.floorIndex ?? 0) === floorIndex
    );
    const common =
      onFloor.find((room) => room.kind === "reception") ??
      onFloor.find((room) => room.kind === "lobby") ??
      onFloor.find((room) => room.kind === "area") ??
      onFloor[0];
    return common?.id ?? null;
  }

  private publishDoor(subscription: any, roomId: string, open: boolean) {
    if (subscription?.state !== "subscribed") return;
    subscription
      .publish({
        type: "office_door",
        roomId,
        open,
        senderId: this.userId,
        at: new Date().toISOString(),
      })
      .catch(() => {
        // The next change or query carries the state again.
      });
  }

  async setDoor(roomId: string, open: boolean) {
    const room = this.rooms.find((candidate) => candidate.id === roomId);
    if (!room || !ownsPersonalOffice(room, this.userId)) {
      throw new Error("Only the owner can open or close this door.");
    }
    try {
      localStorage.setItem(this.doorKey(roomId), open ? "open" : "closed");
    } catch {
      // Private browsing: the door still changes for this visit.
    }
    for (const listener of this.doorListeners) listener(roomId, open);
    this.publishDoor(
      this.doorSubscriptions.get(room.floorIndex ?? 0),
      roomId,
      open
    );
  }

  subscribeDoors(
    floorIndex: number,
    onDoor: (roomId: string, open: boolean) => void
  ): () => void {
    // This user's own doors are known straight away, whatever the network.
    for (const room of this.ownOfficesOn(floorIndex)) {
      const open = this.readOwnDoor(room.id);
      if (open !== null) onDoor(room.id, open);
    }
    const local = (roomId: string, open: boolean) => {
      const room = this.rooms.find((candidate) => candidate.id === roomId);
      if ((room?.floorIndex ?? 0) === floorIndex) onDoor(roomId, open);
    };
    this.doorListeners.add(local);

    const commonRoomId = this.floorCommonRoomId(floorIndex);
    if (!commonRoomId) {
      return () => {
        this.doorListeners.delete(local);
      };
    }

    const client = getSharedCentrifuge();
    const channel = presenceChannel(this.orgId, floorIndex, commonRoomId);
    const subscription = prepareChannelSubscription(client, channel, {
      getToken: () => getSubscriptionToken(channel),
    });
    this.doorSubscriptions.set(floorIndex, subscription);

    const announceOwn = () => {
      for (const room of this.ownOfficesOn(floorIndex)) {
        const open = this.readOwnDoor(room.id);
        if (open !== null) this.publishDoor(subscription, room.id, open);
      }
    };

    const onPublication = (ctx: any) => {
      const data = ctx?.data;
      if (data?.type === "office_door_query") {
        if (data.senderId !== this.userId) announceOwn();
        return;
      }
      if (data?.type !== "office_door" || typeof data.roomId !== "string")
        return;
      // Only the owner's word counts. Centrifugo names the publisher when it
      // can; otherwise the sender id inside the message is all there is.
      const sender = String(ctx?.info?.user ?? data.senderId ?? "");
      const room = this.rooms.find((candidate) => candidate.id === data.roomId);
      if (!room || !sender || !ownsPersonalOffice(room, sender)) return;
      onDoor(room.id, Boolean(data.open));
    };
    const onSubscribed = () => {
      announceOwn();
      subscription
        .publish({ type: "office_door_query", senderId: this.userId })
        .catch(() => {});
    };

    subscription.on("publication", onPublication);
    subscription.on("subscribed", onSubscribed);
    if (subscription.state === "subscribed") onSubscribed();
    subscription.subscribe();

    return () => {
      this.doorListeners.delete(local);
      if (this.doorSubscriptions.get(floorIndex) === subscription) {
        this.doorSubscriptions.delete(floorIndex);
      }
      subscription.off("publication", onPublication);
      subscription.off("subscribed", onSubscribed);
      releaseChannelSubscription(client, channel, subscription);
    };
  }

  async fetchMessages(roomId: string): Promise<OfficeChatMessage[]> {
    const room = this.rooms.find((candidate) => candidate.id === roomId);
    // A locked office is visible in the tower but its conversation is not.
    if (room?.locked) return [];
    const channelId = this.channelIdForRoom(roomId);
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
    const channelId = this.channelIdForRoom(roomId);
    if (!channelId) return () => {};

    // New messages land on the raw backend channel id, the same name the 2D
    // chat subscribes to — there is no office-scoped chat channel to join.
    const client = getSharedCentrifuge();
    const subscription = prepareChannelSubscription(client, channelId, {
      getToken: () => getSubscriptionToken(channelId),
    });

    const onPublication = (ctx: any) => {
      if (ctx?.data?.type !== "message") return;
      const message = toOfficeMessage(roomId, ctx.data, this.userId);
      // The confirmed send result draws our own message; ignore its echo.
      if (!message || message.self) return;
      onMessage(message);
    };

    subscription.on("publication", onPublication);
    subscription.subscribe();

    return () => {
      subscription.off("publication", onPublication);
      releaseChannelSubscription(client, channelId, subscription);
    };
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

  /**
   * Opens the conversation with one person, creating the DM if it does not
   * exist yet.
   *
   * Zedu chat has one rule for a name: clicking it starts the conversation. The
   * office follows the same rule, and that matters beyond the panel, because the
   * server only admits a visitor to a private office when a DM with its owner
   * exists. Creating the DM here is therefore what unlocks the office; the
   * server's admission rule is left exactly as it is.
   *
   * Concurrent openings of the same person share one request, so a double click
   * cannot start two conversations.
   */
  async openConversation(memberUserId: string): Promise<OfficeRoom | null> {
    const room = this.personalRoomFor(memberUserId);
    if (!room) return null;

    const existing = this.dmRoomMap[room.id];
    if (existing) {
      this.unlockPersonalRoom(room.id);
      return this.rooms.find((candidate) => candidate.id === room.id) ?? null;
    }

    const inFlight = this.openingConversations.get(memberUserId);
    if (inFlight) return inFlight;

    const opening = this.createConversation(memberUserId, room.id).finally(() =>
      this.openingConversations.delete(memberUserId)
    );
    this.openingConversations.set(memberUserId, opening);
    return opening;
  }

  private async createConversation(
    memberUserId: string,
    roomId: string
  ): Promise<OfficeRoom> {
    const response = await PostRequest(`/organisations/${this.orgId}/dms`, {
      chat_type: "user",
      participant_id: memberUserId,
    });
    const status = response?.status ?? response?.response?.status;
    const channelId = response?.data?.data?.channel_id;

    if (status !== 200 && status !== 201) {
      throw new Error(
        response?.data?.message ??
          "The conversation could not be started right now."
      );
    }
    if (!channelId) {
      throw new Error("The conversation could not be started right now.");
    }

    this.dmOfficeMap[channelId] = roomId;
    this.dmRoomMap[roomId] = channelId;
    this.unlockPersonalRoom(roomId);

    const room = this.rooms.find((candidate) => candidate.id === roomId);
    if (!room) {
      throw new Error("That office is not part of this building.");
    }
    return room;
  }

  /** The private office that belongs to one person, if the roster has one. */
  private personalRoomFor(memberUserId: string): OfficeRoom | undefined {
    const member = this.members.find(
      (candidate) => candidate.userId === memberUserId
    );
    const byRoomId = member
      ? this.rooms.find((candidate) => candidate.id === member.roomId)
      : undefined;
    return (
      byRoomId ??
      this.rooms.find(
        (candidate) =>
          candidate.kind === "personal" && candidate.refId === memberUserId
      )
    );
  }

  /**
   * A private office with a conversation is visitable and readable. Rooms are
   * replaced rather than mutated so the scene, which compares room lists, sees
   * the change and rebuilds the door.
   */
  private unlockPersonalRoom(roomId: string) {
    this.rooms = this.rooms.map((room) =>
      room.id === roomId ? { ...room, locked: false, chat: true } : room
    );
    this.members = this.members.map((member) =>
      member.roomId === roomId ? { ...member, canVisit: true } : member
    );
  }
}

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

    // The per-floor extras are not seeded scenes: the API owns their name and
    // footprint, so they fall back to a neutral template and derive the walk-in
    // point from the bounds the server sends.
    const template =
      slot ?? (room.kind === "area" ? { ...AREA_FALLBACK_ROOM } : undefined);
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
    const spawn = {
      x: bounds.x + bounds.w / 2,
      z: bounds.z + bounds.d - Math.min(1.6, bounds.d * 0.35),
    };
    const door = { x: bounds.x + bounds.w / 2, z: bounds.z + bounds.d };

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
  private floorByRoom: Record<string, number> = {};

  async init(orgId: string, userId: string) {
    this.orgId = orgId;
    this.userId = userId;

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

  async enterRoom(roomId: string) {
    unwrap(
      await PostRequest(`/office/rooms/${encodeRoomId(roomId)}/enter`, {}),
      "The room could not be entered."
    );
  }

  async leaveRoom(roomId: string) {
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
    // Movement goes out several times a second, so it uses the silent request
    // helper: a refused attempt (409, 429 or a network blip) must not raise a
    // toast, it only hands its status back to the caller to back off with.
    const response = await BuzzRequest(
      `/office/rooms/${encodeRoomId(roomId)}/presence`,
      { position: { x, y: 0, z }, rotation: yaw }
    );
    const status = response?.status ?? response?.response?.status;
    // No answer at all: 0 tells the caller to back off and try again later.
    return typeof status === "number" ? status : 0;
  }

  async fetchOccupants(roomId: string): Promise<OfficeOccupant[]> {
    // Centrifugo only carries what happens after a subscription, so the room
    // is read once to fill in the people who were already standing there.
    const response = await GetRequest(
      `/office/rooms/${encodeRoomId(roomId)}/occupants`
    );

    return (
      unwrap<OfficeOccupant[] | undefined>(
        response,
        "The room could not be read."
      ) ?? []
    );
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
          const next = new Map<string, OfficeOccupant>();
          for (const occupant of occupants) {
            // A departure the stream already carried is newer than this
            // snapshot, so that person is not brought back from it.
            if (ticket.left.has(occupant.userId)) continue;
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
      const presence = ctx?.data?.presence as OfficeOccupant | undefined;
      const eventType = ctx?.data?.type as string | undefined;
      if (!presence) return;

      if (eventType === "leave") {
        roster.delete(presence.userId);
        inFlight?.upserts.delete(presence.userId);
        inFlight?.left.add(presence.userId);
      } else {
        inFlight?.left.delete(presence.userId);
        // Only a record that actually took hold has to survive the snapshot.
        if (apply(roster, presence))
          inFlight?.upserts.set(presence.userId, presence);
      }

      // Emit the complete roster so the UI never has stale entries.
      emit();
    };

    const onSubscribed = () => {
      // Going live (the first time or after a reconnect) is the moment to
      // read the room again: it holds everyone the stream did not carry.
      onState?.("live");
      resync();
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
      subscription.off("publication", onPublication);
      subscription.off("subscribed", onSubscribed);
      subscription.off("unsubscribed", onUnsubscribed);
      releaseChannelSubscription(client, channel, subscription);
      // The roster dies with the subscription it belongs to, so the next room
      // starts from its own snapshot instead of inheriting this one.
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
}

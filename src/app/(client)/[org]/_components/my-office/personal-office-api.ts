"use client";

import { GetRequest, PostRequest, PutRequest } from "~/utils/new-request";
import {
  getSharedCentrifuge,
  getSubscriptionToken,
  prepareChannelSubscription,
  releaseChannelSubscription,
} from "~/lib/centrifugo/shared-centrifuge";
import { DEFAULT_STYLE, type AvatarStyle } from "./office-models";
import { STARTER, type PlacedItem, type Theme } from "./office-scene";

/**
 * Everything the personal office needs from Zedu:
 *   GET/PUT /users/me/avatar                    your look (shared with the building)
 *   GET  /organisations/:org/users              teammates you can visit
 *   GET  /organisations/:org/dms                your conversations
 *   POST /organisations/:org/dms                start or reopen a DM
 *   GET/POST /dms/channels/:channel/threads     DM history and sending
 * plus Centrifugo for live messages.
 */

export interface Person {
  id: string;
  name: string;
  avatar?: string;
}

export interface MyOffice {
  theme: Theme;
  layout: PlacedItem[];
}

/** What a share link carries: whose office it is, how it looks, who sits there. */
export interface SharedOffice extends MyOffice {
  owner: Person;
  style: AvatarStyle;
}

export interface ChatMessage {
  id: string;
  userId: string;
  name: string;
  avatar?: string;
  text: string;
  at: number;
}

type Raw = Record<string, unknown>;
type ApiResponse = { status?: number; data?: { data?: unknown } } | undefined;

const okData = (res: ApiResponse) =>
  res && typeof res.status === "number" && res.status >= 200 && res.status < 300
    ? res.data?.data
    : undefined;

/** The API wraps lists differently per endpoint; take the first array. */
function listOf(value: unknown): Raw[] {
  if (Array.isArray(value)) return value as Raw[];
  if (value && typeof value === "object") {
    for (const inner of Object.values(value))
      if (Array.isArray(inner)) return inner as Raw[];
  }
  return [];
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

export function toMessage(raw: Raw): ChatMessage {
  return {
    id: text(raw.thread_id) || text(raw.id) || `${Date.now()}-${Math.random()}`,
    userId: text(raw.user_id),
    name: text(raw.username) || "Someone",
    avatar: text(raw.avatar_url) || undefined,
    text: text(raw.message) || text(raw.content),
    at: raw.created_at ? new Date(text(raw.created_at)).getTime() : Date.now(),
  };
}

/* ---------- Local copies: the office layout and the extra look details ---------- */

const read = <T>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(`zedu.my-office.${key}`);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(`zedu.my-office.${key}`, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked; the office still works for this visit.
  }
};

export const loadMyOffice = (orgId: string, userId: string): MyOffice =>
  read(`${orgId}.${userId}.office`, { theme: "oak" as Theme, layout: STARTER });

export const saveMyOffice = (orgId: string, userId: string, office: MyOffice) =>
  write(`${orgId}.${userId}.office`, office);

/** Your look: the shared parts from the API, the extra details from this device. */
export async function loadMyStyle(userId: string): Promise<AvatarStyle> {
  const local = read<AvatarStyle>(`${userId}.style`, DEFAULT_STYLE);
  const remote = okData(await GetRequest("/users/me/avatar")) as
    | Partial<AvatarStyle>
    | undefined;
  return {
    ...DEFAULT_STYLE,
    ...local,
    ...(remote?.tint ? remote : {}),
  };
}

export async function saveMyStyle(userId: string, style: AvatarStyle) {
  write(`${userId}.style`, style);
  const { tint, body, outfit, accessory } = style;
  await PutRequest("/users/me/avatar", { tint, body, outfit, accessory });
}

/* ---------- Share links ---------- */

export function encodeOffice(office: SharedOffice) {
  const bytes = new TextEncoder().encode(JSON.stringify(office));
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeOffice(link: string): SharedOffice | null {
  const code = link.match(/office=([A-Za-z0-9_-]+)/)?.[1];
  if (!code) return null;
  try {
    const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const office = JSON.parse(new TextDecoder().decode(bytes)) as SharedOffice;
    return office?.owner?.id && Array.isArray(office.layout) ? office : null;
  } catch {
    return null;
  }
}

/* ---------- People and conversations ---------- */

export async function loadTeammates(
  orgId: string,
  myId: string
): Promise<Person[]> {
  const data = okData(
    await GetRequest(`/organisations/${orgId}/users?page=1&limit=100`)
  );
  return listOf(data)
    .map((raw) => {
      const u = (raw.user as Raw) ?? raw;
      return {
        id: text(u.id) || text(u.user_id),
        name:
          text(u.username) ||
          text(u.display_name) ||
          text(u.full_name) ||
          [text(u.first_name), text(u.last_name)].filter(Boolean).join(" ") ||
          "Teammate",
        avatar: text(u.avatar_url) || undefined,
        type: text(u.entity_type) || text(raw.entity_type),
      };
    })
    .filter((p) => p.id && p.id !== myId && p.type !== "bot")
    .map(({ id, name, avatar }) => ({ id, name, avatar }));
}

export async function loadConversations(orgId: string): Promise<Person[]> {
  const data = okData(await GetRequest(`/organisations/${orgId}/dms`));
  return listOf(data)
    .filter((d) => text(d.participant_id))
    .map((d) => ({
      id: text(d.participant_id),
      name: text(d.username) || "Teammate",
      avatar: text(d.avatar_url) || text(d.default_avatar_url) || undefined,
    }));
}

/** Opens (or reopens) the DM with someone and returns its channel id. */
export async function openDm(orgId: string, personId: string) {
  const data = okData(
    await PostRequest(`/organisations/${orgId}/dms`, {
      chat_type: "user",
      participant_id: personId,
    })
  ) as Raw | undefined;
  const channelId = text(data?.channel_id);
  if (!channelId) throw new Error("The conversation could not be opened.");
  return channelId;
}

export async function loadDm(channelId: string) {
  const data = okData(
    await GetRequest(`/dms/channels/${channelId}/threads?page=1&limit=40`)
  );
  return listOf(data)
    .map(toMessage)
    .filter((m) => m.text)
    .sort((a, b) => a.at - b.at);
}

export async function sendDm(channelId: string, content: string) {
  const data = okData(
    await PostRequest(`/dms/channels/${channelId}/threads`, { content })
  );
  if (data === undefined) throw new Error("Message not sent.");
  return data && typeof data === "object" ? toMessage(data as Raw) : null;
}

/**
 * Live messages for a DM. Uses the app's Centrifugo connection when one is
 * configured, and also re-reads the history every few seconds so a dropped
 * connection never loses a reply. Callers drop duplicates by message id.
 */
export function watchDm(
  channelId: string,
  onMessage: (m: ChatMessage) => void
) {
  const stops: Array<() => void> = [];
  if (process.env.NEXT_PUBLIC_CONNECT_URL) {
    const client = getSharedCentrifuge();
    const sub = prepareChannelSubscription(client, channelId, {
      getToken: () => getSubscriptionToken(channelId),
    });
    const handler = (ctx: { data?: Raw }) => {
      const d = ctx.data;
      if (d && (d.type === "thread" || d.type === "message"))
        onMessage(toMessage(d));
    };
    sub.on("publication", handler);
    if (sub.state !== "subscribed") sub.subscribe();
    stops.push(() => {
      sub.removeListener("publication", handler);
      releaseChannelSubscription(client, channelId, sub);
    });
  }
  const timer = setInterval(async () => {
    (await loadDm(channelId)).forEach(onMessage);
  }, 5000);
  stops.push(() => clearInterval(timer));
  return () => stops.forEach((stop) => stop());
}

import { Centrifuge, type PublicationContext } from "centrifuge";

import type { ZeduSession } from "./desktop-bridge";

/**
 * Channel rooms inside Zedu Desktop talk to zedu-be, where the conversation
 * really lives; the office backend mirrors the channels under the same IDs.
 *
 * Plain fetch, not the shared axios helpers: those attach the office token,
 * and their 401 handling would end the office session when only the zedu one
 * has expired.
 */
async function zeduRequest<T>(
  session: ZeduSession,
  path: string,
  init?: { method: "POST"; body: unknown }
): Promise<T> {
  const response = await fetch(`${session.apiUrl}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
    },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  const body = await response.json().catch(() => null);

  if (response.status === 401) {
    throw new Error(
      "Your Zedu session has expired. Reopen the office from Zedu Desktop."
    );
  }
  if (!response.ok) {
    throw new Error(body?.message || "Zedu did not answer.");
  }
  return body?.data as T;
}

const selfIds = new Map<string, Promise<string>>();

/**
 * The signed-in person's zedu user ID. It can differ from their office ID
 * (an office account that existed before is matched by email), and zedu
 * messages carry the zedu one.
 */
export function zeduSelfId(session: ZeduSession): Promise<string> {
  const cached = selfIds.get(session.token);
  if (cached) return cached;

  const lookup = zeduRequest<{ user?: { id?: string; user_id?: string } }>(
    session,
    "/users/me"
  )
    .then((data) => data?.user?.user_id ?? data?.user?.id ?? "")
    .catch((error) => {
      selfIds.delete(session.token);
      throw error;
    });
  selfIds.set(session.token, lookup);
  return lookup;
}

/** A zedu conversation behind an office room: a channel or a direct message. */
export type ZeduConversation = { kind: "channel" | "dm"; id: string };

export async function fetchZeduThreads(
  session: ZeduSession,
  conversation: ZeduConversation
): Promise<unknown[]> {
  const id = encodeURIComponent(conversation.id);
  const rows = await zeduRequest<unknown[] | null>(
    session,
    conversation.kind === "channel"
      ? `/threads/channels/${id}?page=1&limit=40`
      : `/dms/channels/${id}/threads?page=1&limit=50`
  );
  return Array.isArray(rows) ? rows : [];
}

type ZeduDm = { channel_id?: string; participant_email?: string };
type ZeduMember = { id?: string; email?: string };

/**
 * The zedu DM with one colleague, found by their email or started if there
 * is none. zedu-be only spots an existing DM when the caller started it, so
 * the DM list is read first to avoid opening a second one.
 */
export async function resolveZeduDm(
  session: ZeduSession,
  orgId: string,
  participantEmail: string
): Promise<string | null> {
  const email = participantEmail.trim().toLowerCase();
  if (!email) return null;
  const org = encodeURIComponent(orgId);

  const dms =
    (await zeduRequest<ZeduDm[] | null>(
      session,
      `/organisations/${org}/dms?page=1&limit=200`
    )) ?? [];
  const existing = dms.find(
    (dm) => dm.participant_email?.toLowerCase() === email
  );
  if (existing?.channel_id) return existing.channel_id;

  const members =
    (await zeduRequest<ZeduMember[] | null>(
      session,
      `/organisations/${org}/users?search=${encodeURIComponent(email)}&limit=20`
    )) ?? [];
  const participant = members.find(
    (member) => member.email?.toLowerCase() === email
  );
  if (!participant?.id) return null;

  const created = await zeduRequest<{ channel_id?: string } | null>(
    session,
    `/organisations/${org}/dms`,
    {
      method: "POST",
      body: { chat_type: "user", participant_id: participant.id },
    }
  );
  return created?.channel_id ?? null;
}

let zeduRealtime: { key: string; client: Centrifuge } | null = null;
// Listeners per channel on the current client. A new client gets a new map,
// so a cleanup from the previous client never changes the new one's counts.
let listenerCounts = new Map<string, number>();

/**
 * One connection to zedu-be's Centrifugo, separate from the office's own,
 * signed with the zedu session. A new session or address replaces it.
 */
function zeduCentrifuge(session: ZeduSession & { connectUrl: string }) {
  const key = `${session.connectUrl}|${session.token}`;
  if (zeduRealtime?.key === key) return zeduRealtime.client;

  zeduRealtime?.client.disconnect();
  listenerCounts = new Map<string, number>();
  const client = new Centrifuge(session.connectUrl, {
    getToken: async () =>
      (await zeduRequest<{ token: string }>(session, "/token/connection"))
        .token,
    minReconnectDelay: 1_500,
    maxReconnectDelay: 30_000,
  });
  client.connect();
  zeduRealtime = { key, client };
  return client;
}

/**
 * Live publications on a zedu channel. Returns null when the office was not
 * given zedu's realtime address, so the caller can poll instead.
 */
export function subscribeZeduChannel(
  session: ZeduSession,
  channelId: string,
  onData: (data: any) => void
): (() => void) | null {
  if (!session.connectUrl) return null;
  const client = zeduCentrifuge({ ...session, connectUrl: session.connectUrl });
  const counts = listenerCounts;

  const subscription =
    client.getSubscription(channelId) ??
    client.newSubscription(channelId, {
      getToken: async () =>
        (
          await zeduRequest<{ token: string }>(session, "/token/subscription", {
            method: "POST",
            body: { channel: channelId },
          })
        ).token,
      minResubscribeDelay: 2_000,
      maxResubscribeDelay: 60_000,
    });
  const onPublication = (ctx: PublicationContext) => onData(ctx.data);

  subscription.on("publication", onPublication);
  counts.set(channelId, (counts.get(channelId) ?? 0) + 1);
  subscription.subscribe();

  return () => {
    subscription.off("publication", onPublication);
    const remaining = (counts.get(channelId) ?? 1) - 1;
    if (remaining > 0) {
      counts.set(channelId, remaining);
      return;
    }
    counts.delete(channelId);
    subscription.unsubscribe();
    client.removeSubscription(subscription);
  };
}

export async function postZeduThread(
  session: ZeduSession,
  conversation: ZeduConversation,
  payload: { content: string; thread_id: string; media: unknown[] }
): Promise<void> {
  const id = encodeURIComponent(conversation.id);
  await zeduRequest(
    session,
    conversation.kind === "channel"
      ? `/threads/${id}`
      : `/dms/channels/${id}/threads`,
    { method: "POST", body: payload }
  );
}

import { z } from "zod";
import type { OfficeZoeContext, OfficeZoeHistoryMessage } from "~/types/office";

/** How many recent messages travel with a question, to keep payloads small. */
export const ZOE_HISTORY_LIMIT = 8;

const ZoeHistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

export const ZoeRequestSchema = z.object({
  question: z.string().min(1).max(2000),
  history: z.array(ZoeHistoryMessageSchema).max(ZOE_HISTORY_LIMIT).optional(),
  context: z.object({
    room: z.object({
      id: z.string(),
      kind: z.string(),
      name: z.string(),
    }),
    nearbyUsers: z.array(
      z.object({
        displayName: z.string(),
        status: z.string(),
      })
    ),
  }),
});

export function createZoeRequest(
  question: string,
  context: OfficeZoeContext,
  orgId: string,
  history: OfficeZoeHistoryMessage[] = []
) {
  // Only completed turns are useful, and the newest ones matter most. The
  // route validates the same limit for callers that bypass this helper.
  const recent = history
    .filter((message) => message.content.trim().length > 0)
    .slice(-ZOE_HISTORY_LIMIT)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 4000),
    }));

  return {
    question,
    ...(recent.length > 0 ? { history: recent } : {}),
    context: {
      location: "office",
      buildingId: orgId,
      room: context.room,
      nearbyUsers: context.nearbyUsers,
    },
  };
}

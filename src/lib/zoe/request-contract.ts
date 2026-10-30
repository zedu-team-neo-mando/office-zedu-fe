import { z } from "zod";
import type { OfficeZoeContext } from "~/types/office";

export const ZoeRequestSchema = z.object({
  question: z.string().min(1).max(2000),
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
  orgId: string
) {
  return {
    question,
    context: {
      location: "office",
      buildingId: orgId,
      room: context.room,
      nearbyUsers: context.nearbyUsers,
    },
  };
}

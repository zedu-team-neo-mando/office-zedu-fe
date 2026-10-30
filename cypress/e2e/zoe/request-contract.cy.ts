import {
  createZoeRequest,
  ZoeRequestSchema,
} from "../../../src/lib/zoe/request-contract";

describe("Zoe request contract", () => {
  it("builds a client request accepted by the route schema", () => {
    const request = createZoeRequest(
      "Where can I find the meeting room?",
      {
        room: { id: "room-1", kind: "meeting", name: "Meeting Room" },
        nearbyUsers: [{ displayName: "Ada", status: "online" }],
      },
      "org-1"
    );

    expect(ZoeRequestSchema.safeParse(request).success).to.equal(true);
  });
});

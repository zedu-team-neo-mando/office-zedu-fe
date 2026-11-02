/**
 * Room admission is decided by the server. When it says no, the office has to
 * know why: a full room sends the player back out and marks the room as full,
 * anything else is reported as it came back.
 */
export class OfficeEntryError extends Error {
  readonly roomId: string;
  readonly code?: string;
  readonly status?: number;

  constructor(message: string, roomId: string, code?: string, status?: number) {
    super(message);
    this.name = "OfficeEntryError";
    this.roomId = roomId;
    this.code = code;
    this.status = status;
  }

  /** The room is at capacity, as opposed to any other refusal. */
  get full() {
    return this.code === "room_full";
  }
}

export function isRoomFullError(error: unknown): boolean {
  return error instanceof OfficeEntryError && error.full;
}

/**
 * Reads an entry refusal out of whatever the request helper handed back: an
 * axios response, or the axios error it resolved with instead of throwing.
 * Returns null when the room was entered.
 */
export function entryErrorFromResponse(
  response: any,
  roomId: string
): OfficeEntryError | null {
  const status: unknown = response?.response?.status ?? response?.status;
  if (typeof status === "number" && status >= 200 && status < 300) {
    return null;
  }

  const body = response?.response?.data ?? response?.data ?? {};
  const message =
    typeof body?.message === "string" && body.message
      ? body.message
      : "The room could not be entered.";
  const rawCode = body?.code ?? body?.error ?? body?.data?.code;
  let code = typeof rawCode === "string" ? rawCode : undefined;
  // Older builds of the API only send the message, so a 403 that says the
  // room is full is still read as a full room.
  if (!code && status === 403 && /full/i.test(message)) code = "room_full";

  return new OfficeEntryError(
    message,
    roomId,
    code,
    typeof status === "number" ? status : undefined
  );
}

/**
 * A spot just outside a room's door, on the corridor side, so a player who
 * was refused entry is put back where they came from rather than left inside.
 */
export function outsideDoor(room: {
  bounds: { x: number; z: number; w: number; d: number };
  door: { x: number; z: number };
}) {
  const { bounds, door } = room;
  const step = 0.9;
  const edges = [
    { distance: Math.abs(door.z - bounds.z), dx: 0, dz: -1 },
    { distance: Math.abs(door.z - (bounds.z + bounds.d)), dx: 0, dz: 1 },
    { distance: Math.abs(door.x - bounds.x), dx: -1, dz: 0 },
    { distance: Math.abs(door.x - (bounds.x + bounds.w)), dx: 1, dz: 0 },
  ];
  const nearest = edges.reduce((best, edge) =>
    edge.distance < best.distance ? edge : best
  );
  return {
    x: door.x + nearest.dx * step,
    z: door.z + nearest.dz * step,
    // Face away from the room, back towards the corridor.
    yaw: Math.atan2(nearest.dx, nearest.dz),
  };
}

import {
  CATALOG_BY_ID,
  type FurnitureItem,
  type OfficeRoom,
  validatePlacement,
} from "./office-data";

/** A starter piece, before it becomes a layout item. */
interface TemplatePiece {
  /** Item id suffix, so an office's ids are stable and unique to it. */
  key: string;
  catalogId: string;
  x: number;
  z: number;
  rotation: FurnitureItem["rotation"];
}

/** Two decimals is enough for a layout, and keeps the payload readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roomContains(room: OfficeRoom, x: number, z: number): boolean {
  const b = room.bounds;
  return x >= b.x && x <= b.x + b.w && z >= b.z && z <= b.z + b.d;
}

/**
 * Whether a room is somebody's own office. Only the owner may change its
 * furniture; everybody else visits it read-only.
 */
export function ownsPersonalOffice(room: OfficeRoom, userId: string): boolean {
  return (
    room.kind === "personal" &&
    Boolean(userId) &&
    (room.ownerId === userId || room.id === `personal:${userId}`)
  );
}

/**
 * The furniture a personal office starts with.
 *
 * The desk stands out in the room on its own rug. The owner's chair sits on
 * the wall side of it, facing visitors who come in, and the back wall holds a
 * plant, an open bookshelf and a reading lamp; the framed print hangs between
 * them. Every piece is an ordinary layout item, so the owner can select, move,
 * rotate, delete and keep it. It is sized from the room, so both the 5 by 5.4
 * member office and the demo's wider offices work: a piece that would cross a
 * wall, block the doorway or overlap something already in the room is left out
 * rather than forced in.
 */
export function personalOfficeTemplate(room: OfficeRoom): FurnitureItem[] {
  const b = room.bounds;
  const cx = b.x + b.w / 2;
  const roomy = b.w >= 4.2 && b.d >= 4.2;
  // A small office keeps the desk near the wall so the doorway stays clear.
  const deskZ =
    b.z + (roomy ? Math.min(1.9, b.d * 0.36) : Math.min(1.3, b.d * 0.26));
  // Along the back wall: a footprint is 1 by 1, so 0.65 clears the wall.
  const backZ = b.z + 0.65;

  const pieces: TemplatePiece[] = [
    { key: "rug", catalogId: "rug", x: cx, z: deskZ + 0.55, rotation: 0 },
    // The owner sits at the wall side, behind the desk, facing visitors.
    {
      key: "desk",
      catalogId: "desk_oak",
      x: cx,
      z: deskZ + 1.1,
      rotation: 180,
    },
    {
      key: "chair",
      catalogId: "chair_ergo",
      x: cx,
      z: deskZ,
      rotation: 0,
    },
    { key: "plant", catalogId: "plant", x: b.x + 0.65, z: backZ, rotation: 0 },
    {
      key: "shelf",
      catalogId: "shelf",
      x: b.x + 1.75,
      z: backZ,
      rotation: 0,
    },
    {
      key: "lamp",
      catalogId: "lamp",
      x: b.x + b.w - 0.65,
      z: backZ,
      rotation: 0,
    },
  ];

  if (b.w >= 6.0 && b.d >= 6.5) {
    pieces.push({
      key: "sofa",
      catalogId: "sofa",
      x: b.x + b.w - 1.1,
      z: b.z + b.d - 2.0,
      rotation: 270,
    });
  }

  const items: FurnitureItem[] = [];
  for (const piece of pieces) {
    if (!CATALOG_BY_ID[piece.catalogId]) continue;
    const item: FurnitureItem = {
      id: `${room.id}-${piece.key}`,
      roomId: room.id,
      catalogId: piece.catalogId,
      x: round(piece.x),
      z: round(piece.z),
      rotation: piece.rotation,
    };
    const blocked = validatePlacement(
      items,
      item.catalogId,
      item.x,
      item.z,
      item.rotation,
      room
    );
    if (blocked) continue;
    items.push(item);
  }
  return items;
}

/**
 * Gives every personal office that has never been saved its starter layout.
 *
 * A stored layout always wins, including one the owner emptied on purpose: the
 * presence of the room key is what says "this office has a saved layout record".
 * Rooms of other kinds are left alone, and the result is a new map, so a server
 * payload is never mutated.
 */
export function withPersonalOfficeDefaults(
  rooms: OfficeRoom[],
  layouts: Record<string, FurnitureItem[]>
): Record<string, FurnitureItem[]> {
  const next = { ...layouts };
  for (const room of rooms) {
    if (room.kind !== "personal") continue;
    if (next[room.id] !== undefined) continue;
    next[room.id] = personalOfficeTemplate(room);
  }
  return next;
}

/**
 * The furniture of the storey the engine is drawing.
 *
 * Offices on different member floors share the same coordinates, so a position
 * alone cannot say which storey a piece belongs to. Items carry the id of the
 * room whose layout they were saved in; without that check one floor's desks
 * would be drawn on every floor. Items saved before the id was stored fall
 * back to the position test the engine used before.
 */
export function floorLayoutItems(
  items: FurnitureItem[],
  rooms: OfficeRoom[]
): FurnitureItem[] {
  const onFloor = new Set(rooms.map((room) => room.id));
  return items.filter((item) =>
    item.roomId
      ? onFloor.has(item.roomId)
      : rooms.some((room) => roomContains(room, item.x, item.z))
  );
}

/** The items that belong to one room, for placement and collision checks. */
export function roomLayoutItems(
  items: FurnitureItem[],
  room: OfficeRoom
): FurnitureItem[] {
  return items.filter((item) =>
    item.roomId ? item.roomId === room.id : roomContains(room, item.x, item.z)
  );
}

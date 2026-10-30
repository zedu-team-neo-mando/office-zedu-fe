const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadModule(filePath, mockModules = {}) {
  const content = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(content, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const m = { exports: {} };
  const customRequire = (id) => {
    if (mockModules[id]) return mockModules[id];
    if (id.startsWith("./") || id.startsWith("../")) {
      const resolved = path.resolve(path.dirname(filePath), id);
      const withExt = fs.existsSync(resolved + ".ts")
        ? resolved + ".ts"
        : fs.existsSync(resolved + ".tsx")
          ? resolved + ".tsx"
          : resolved;
      return loadModule(withExt, mockModules);
    }
    return require(id);
  };
  const fn = new Function(
    "exports",
    "require",
    "module",
    "__filename",
    "__dirname",
    transpiled
  );
  fn(m.exports, customRequire, m, filePath, path.dirname(filePath));
  return m.exports;
}

const rootDir = path.join(__dirname, "..");
const dataMod = loadModule(
  path.join(rootDir, "src/app/office/_components/office-data.ts")
);
const layoutMod = loadModule(
  path.join(rootDir, "src/app/office/_components/office-layout.ts"),
  {
    "./office-data": dataMod,
  }
);

const {
  roomContains,
  ownsPersonalOffice,
  personalOfficeTemplate,
  withPersonalOfficeDefaults,
  floorLayoutItems,
  roomLayoutItems,
} = layoutMod;

const { ROOMS, validatePlacement, CATALOG_BY_ID } = dataMod;

test("personalOfficeTemplate generates valid, editable catalog items", () => {
  const memberOffice = {
    id: "personal:alice",
    kind: "personal",
    name: "Alice's Office",
    ownerId: "user_alice",
    bounds: { x: 0, z: 0, w: 5, d: 5.4 },
    door: { x: 2.5, z: 5.4 },
  };

  const items = personalOfficeTemplate(memberOffice);
  assert.ok(items.length >= 5, "Should generate at least 5 default items");

  const catalogIds = items.map((item) => item.catalogId);
  assert.ok(catalogIds.includes("desk_oak"), "Contains desk_oak");
  assert.ok(catalogIds.includes("chair_ergo"), "Contains chair_ergo");
  assert.ok(catalogIds.includes("plant"), "Contains plant");
  assert.ok(catalogIds.includes("shelf"), "Contains shelf");
  assert.ok(catalogIds.includes("rug"), "Contains rug");

  for (const item of items) {
    assert.equal(item.roomId, memberOffice.id, "Attaches correct roomId");
    assert.ok(item.id.startsWith(memberOffice.id), "Prefixes id with roomId");
    assert.ok(CATALOG_BY_ID[item.catalogId], "Is a valid catalog item");

    // Verify item is placed strictly within the room bounds
    assert.ok(
      roomContains(memberOffice, item.x, item.z),
      `Item ${item.catalogId} is within room bounds`
    );
  }

  // Verify all items sequentially placed as personalOfficeTemplate does
  const placed = [];
  for (const item of items) {
    const err = validatePlacement(
      placed,
      item.catalogId,
      item.x,
      item.z,
      item.rotation,
      memberOffice
    );
    assert.equal(
      err,
      null,
      `Item ${item.catalogId} passes sequential placement`
    );
    placed.push(item);
  }

  // Verify non-rug colliding items do not collide with each other
  const collidingItems = items.filter(
    (item) => CATALOG_BY_ID[item.catalogId]?.collision
  );
  for (let i = 0; i < collidingItems.length; i++) {
    const candidate = collidingItems[i];
    const others = collidingItems.filter((_, idx) => idx !== i);
    const err = validatePlacement(
      others,
      candidate.catalogId,
      candidate.x,
      candidate.z,
      candidate.rotation,
      memberOffice
    );
    assert.equal(
      err,
      null,
      `Colliding item ${candidate.catalogId} passes validation among objects`
    );
  }
});

test("personalOfficeTemplate includes sofa for spacious personal offices", () => {
  const spaciousOffice = {
    id: "personal:executive",
    kind: "personal",
    name: "Executive Office",
    ownerId: "user_exec",
    bounds: { x: 20, z: 20, w: 6.5, d: 7.0 },
    door: { x: 20, z: 23.5 },
  };

  const items = personalOfficeTemplate(spaciousOffice);
  const catalogIds = items.map((item) => item.catalogId);
  assert.ok(catalogIds.includes("sofa"), "Spacious office receives a sofa");
});

test("withPersonalOfficeDefaults seeds uninitialized personal offices and preserves other rooms", () => {
  const rooms = [
    {
      id: "personal:bob",
      kind: "personal",
      ownerId: "user_bob",
      bounds: { x: 10, z: 10, w: 5, d: 5.4 },
      door: { x: 12.5, z: 15.4 },
    },
    {
      id: "channel:general",
      kind: "channel",
      bounds: { x: 30, z: 10, w: 8, d: 8 },
    },
    {
      id: "meeting:room1",
      kind: "meeting",
      bounds: { x: 50, z: 10, w: 6, d: 6 },
    },
  ];

  const initialLayouts = {};
  const result = withPersonalOfficeDefaults(rooms, initialLayouts);

  // Bob's personal office should be seeded
  assert.ok(result["personal:bob"], "Bob's office is seeded");
  assert.ok(result["personal:bob"].length >= 5);

  // Other rooms must NOT be seeded
  assert.equal(result["channel:general"], undefined, "Channel room untouched");
  assert.equal(result["meeting:room1"], undefined, "Meeting room untouched");

  // Original layouts object is not mutated
  assert.deepEqual(initialLayouts, {}, "Input map not mutated");
});

test("withPersonalOfficeDefaults preserves existing custom layouts", () => {
  const rooms = [
    {
      id: "personal:carol",
      kind: "personal",
      ownerId: "user_carol",
      bounds: { x: 10, z: 10, w: 5, d: 5.4 },
      door: { x: 12.5, z: 15.4 },
    },
  ];

  const customItem = {
    id: "custom-plant",
    roomId: "personal:carol",
    catalogId: "plant",
    x: 12,
    z: 12,
    rotation: 0,
  };
  const existingLayouts = { "personal:carol": [customItem] };

  const result = withPersonalOfficeDefaults(rooms, existingLayouts);
  assert.equal(result["personal:carol"].length, 1);
  assert.equal(result["personal:carol"][0].id, "custom-plant");
});

test("withPersonalOfficeDefaults strictly preserves intentionally empty saved layouts (Condition 2)", () => {
  const rooms = [
    {
      id: "personal:empty_user",
      kind: "personal",
      ownerId: "user_empty",
      bounds: { x: 10, z: 10, w: 5, d: 5.4 },
      door: { x: 12.5, z: 15.4 },
    },
  ];

  // Intentionally empty saved layout from earlier autosave or deliberate clearing
  const savedEmptyLayouts = { "personal:empty_user": [] };

  const result = withPersonalOfficeDefaults(rooms, savedEmptyLayouts);
  assert.ok(Array.isArray(result["personal:empty_user"]));
  assert.equal(
    result["personal:empty_user"].length,
    0,
    "Saved empty layout must NOT be overwritten on load"
  );
});

test("Reset functionality restores default editable furniture for existing empty office (Condition 2)", async () => {
  const room = {
    id: "personal:user_reset",
    kind: "personal",
    ownerId: "user_reset",
    bounds: { x: 0, z: 0, w: 5, d: 5.4 },
    door: { x: 2.5, z: 5.4 },
  };

  // 1. Test live office reset logic
  let savedPayload = null;
  const mockLiveSource = {
    userId: "user_reset",
    rooms: [room],
    async saveLayout(roomId, items) {
      savedPayload = { roomId, items };
    },
    async resetLayout(roomId) {
      const candidate = this.rooms.find((r) => r.id === roomId);
      if (candidate && ownsPersonalOffice(candidate, this.userId)) {
        const defaults = personalOfficeTemplate(candidate);
        await this.saveLayout(roomId, defaults);
        return defaults;
      }
      return [];
    },
  };

  const restored = await mockLiveSource.resetLayout("personal:user_reset");
  assert.ok(restored.length >= 5, "Restored default pieces");
  assert.equal(savedPayload.roomId, "personal:user_reset");
  assert.equal(savedPayload.items.length, restored.length);
  assert.ok(
    savedPayload.items.some((item) => item.catalogId === "desk_oak"),
    "Restored desk"
  );
  assert.ok(
    savedPayload.items.some((item) => item.catalogId === "chair_ergo"),
    "Restored chair"
  );
});

test("ownsPersonalOffice enforces ownership permissions", () => {
  const room = {
    id: "personal:dan",
    kind: "personal",
    ownerId: "dan",
    bounds: { x: 0, z: 0, w: 5, d: 5 },
  };

  assert.equal(ownsPersonalOffice(room, "dan"), true, "Owner has access");
  assert.equal(ownsPersonalOffice(room, "personal:dan"), false);
  assert.equal(ownsPersonalOffice(room, "eve"), false, "Guest denied");
  assert.equal(ownsPersonalOffice(room, ""), false, "Empty user denied");

  const channelRoom = {
    id: "channel:general",
    kind: "channel",
    ownerId: "dan",
    bounds: { x: 0, z: 0, w: 5, d: 5 },
  };
  assert.equal(
    ownsPersonalOffice(channelRoom, "dan"),
    false,
    "Channel not personal"
  );
});

test("floorLayoutItems isolates furniture across floors by roomId", () => {
  const floor1Rooms = [
    { id: "personal:floor1_room", bounds: { x: 0, z: 0, w: 10, d: 10 } },
  ];
  const floor2Rooms = [
    { id: "personal:floor2_room", bounds: { x: 0, z: 0, w: 10, d: 10 } },
  ];

  const items = [
    {
      id: "item1",
      roomId: "personal:floor1_room",
      catalogId: "desk_oak",
      x: 5,
      z: 5,
      rotation: 0,
    },
    {
      id: "item2",
      roomId: "personal:floor2_room",
      catalogId: "sofa",
      x: 5,
      z: 5,
      rotation: 0,
    },
    // Legacy item without roomId
    {
      id: "legacy_item",
      catalogId: "plant",
      x: 5,
      z: 5,
      rotation: 0,
    },
  ];

  const onFloor1 = floorLayoutItems(items, floor1Rooms);
  assert.equal(onFloor1.length, 2);
  assert.ok(
    onFloor1.some((i) => i.id === "item1"),
    "Includes floor 1 item"
  );
  assert.ok(
    onFloor1.some((i) => i.id === "legacy_item"),
    "Includes legacy item via bounds"
  );
  assert.ok(!onFloor1.some((i) => i.id === "item2"), "Excludes floor 2 item");

  const onFloor2 = floorLayoutItems(items, floor2Rooms);
  assert.equal(onFloor2.length, 2);
  assert.ok(
    onFloor2.some((i) => i.id === "item2"),
    "Includes floor 2 item"
  );
  assert.ok(!onFloor2.some((i) => i.id === "item1"), "Excludes floor 1 item");
});

test("roomLayoutItems isolates collision checks to current room", () => {
  const roomA = { id: "room_a", bounds: { x: 0, z: 0, w: 10, d: 10 } };
  const items = [
    { id: "a1", roomId: "room_a", catalogId: "plant", x: 2, z: 2, rotation: 0 },
    { id: "b1", roomId: "room_b", catalogId: "plant", x: 2, z: 2, rotation: 0 },
  ];

  const isolated = roomLayoutItems(items, roomA);
  assert.equal(isolated.length, 1);
  assert.equal(isolated[0].id, "a1");
});

test("OfficeEngine addLiveFurniture does not add static furniture to personal offices", () => {
  const engineSource = fs.readFileSync(
    path.join(rootDir, "src/app/office/_components/engine/OfficeEngine.ts"),
    "utf8"
  );

  // In addLiveFurniture, case "personal" must NOT call addPrivateOffice
  const personalCaseMatch = engineSource.match(
    /case "personal":\s*\{([\s\S]*?)break;/
  );
  assert.ok(personalCaseMatch, "Found case personal in OfficeEngine");
  const caseBody = personalCaseMatch[1];
  assert.ok(
    !caseBody.includes("addPrivateOffice"),
    "addLiveFurniture must NOT call addPrivateOffice for personal rooms"
  );
  assert.ok(
    caseBody.includes("addWallArt"),
    "Personal office retains decorative wall art"
  );
});

test("OfficeDemo placeFurniture sets roomId on new items", () => {
  const demoSource = fs.readFileSync(
    path.join(rootDir, "src/app/office/_components/OfficeDemo.tsx"),
    "utf8"
  );

  const placeItemMatch = demoSource.match(
    /function placeFurniture[\s\S]*?const item: FurnitureItem = \{([\s\S]*?)\};/
  );
  assert.ok(placeItemMatch, "Found placeFurniture item construction");
  const itemDef = placeItemMatch[1];
  assert.ok(
    itemDef.includes("roomId: room.id"),
    "placeFurniture must attach roomId: room.id to newly placed item"
  );
});

test("personalOfficeTemplate furnishes the reviewed layout: desk out in the room, back wall lined", () => {
  const memberOffice = {
    id: "personal:frank",
    kind: "personal",
    name: "Frank's Office",
    ownerId: "user_frank",
    bounds: { x: 0, z: 0, w: 5, d: 5.4 },
    door: { x: 2.5, z: 5.4 },
  };
  const items = personalOfficeTemplate(memberOffice);
  const byId = Object.fromEntries(items.map((item) => [item.catalogId, item]));

  for (const id of [
    "rug",
    "desk_oak",
    "chair_ergo",
    "plant",
    "shelf",
    "lamp",
  ]) {
    assert.ok(byId[id], `Contains ${id}`);
  }
  // The desk stands in the room, not against the back wall, on its own rug.
  assert.ok(byId.desk_oak.z >= 1.5, "Desk is out in the room");
  assert.ok(byId.chair_ergo.z > byId.desk_oak.z, "Chair is behind the desk");
  assert.ok(
    Math.abs(byId.rug.z - byId.desk_oak.z) < 1,
    "Rug lies under the desk and chair"
  );
  // Plant, bookshelf and lamp line the back wall.
  for (const id of ["plant", "shelf", "lamp"]) {
    assert.ok(byId[id].z < 1, `${id} is against the back wall`);
  }
});

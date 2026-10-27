const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const THREE = require("three");

const folder = path.join(__dirname, "../src/app/office/_components");
const cache = new Map();
function load(file) {
  const absolute = path.resolve(folder, file);
  if (cache.has(absolute)) return cache.get(absolute);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(absolute, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  new Function("require", "module", "exports", code)(
    (id) => {
      if (id === "./tower-scene") return {};
      return id.startsWith(".")
        ? load(
            path.relative(
              folder,
              path.resolve(path.dirname(absolute), id + ".ts")
            )
          )
        : require(id);
    },
    module,
    module.exports
  );
  cache.set(absolute, module.exports);
  return module.exports;
}
const { OfficeEngine } = load("engine/OfficeEngine.ts");

function makeRoom(id, x, z, w = 8, d = 6) {
  return {
    id,
    kind: "personal",
    floorIndex: 1,
    bounds: { x, z, w, d },
    locked: false,
  };
}
function layout(rooms) {
  const engine = Object.create(OfficeEngine.prototype);
  engine.isLive = true;
  engine.activeFloor = 1;
  engine.rooms = rooms;
  engine.allRooms = rooms;
  engine.floorPlane = new THREE.Object3D();
  engine.staticGroup = new THREE.Group();
  engine.buildingGroup = new THREE.Group();
  engine.wallColliders = [];
  engine.staticColliders = [];
  engine.furnitureColliders = [];
  engine.colliders = [];
  engine.updatePlan();
  return engine;
}

test("office bounds, doors and spawn positions are not changed", () => {
  const rooms = [makeRoom("a", 0, 0), makeRoom("b", 10, 0)];
  rooms[0].door = { x: 4, z: 6 };
  rooms[0].spawn = { x: 4, z: 4.4 };
  const before = structuredClone(rooms);
  layout(rooms);
  assert.deepEqual(rooms, before);
});

test("platform keeps narrow boundary clearance and the front doorway corridor", () => {
  const engine = layout([makeRoom("a", 0, 0), makeRoom("b", 10, 0)]);
  assert.deepEqual(engine.planBounds, {
    minX: -0.35,
    maxX: 18.35,
    minZ: -0.35,
    maxZ: 8,
  });
  assert.deepEqual(engine.walkBounds, [engine.planBounds]);
  assert.ok(Math.abs(engine.floorPlane.position.x - 9) < 1e-8);
  assert.ok(Math.abs(engine.floorPlane.position.z - 3.825) < 1e-8);
});

test("rendered platform and front edge match the navigation footprint", () => {
  const engine = layout([makeRoom("a", 0, 0)]);
  engine.addLiveGround();
  const platform = engine.staticGroup.getObjectByName("live-walkable-platform");
  const edge = engine.staticGroup.getObjectByName("live-corridor-edge");
  assert.equal(platform.geometry.parameters.width, engine.planWidth);
  assert.equal(platform.geometry.parameters.depth, engine.planDepth);
  assert.equal(platform.position.x, engine.floorPlane.position.x);
  assert.equal(platform.position.z, engine.floorPlane.position.z);
  assert.equal(
    edge.position.z + edge.geometry.parameters.depth / 2,
    engine.planBounds.maxZ
  );
});

test("front corridor supports walking across its width with real room-wall collision", () => {
  const engine = layout([makeRoom("a", 0, 0), makeRoom("b", 10, 0)]);
  engine.colliders = [
    { minX: 0, maxX: 18, minZ: -0.07, maxZ: 0.07 },
    { minX: -0.07, maxX: 0.07, minZ: 0, maxZ: 6 },
    { minX: 17.93, maxX: 18.07, minZ: 0, maxZ: 6 },
  ];
  for (const z of [6.5, 7, 7.5]) {
    assert.equal(engine.isBlocked(1, z), false);
    assert.equal(engine.isBlocked(17, z), false);
    const route = engine.findPath(1, z, 17, z);
    assert.ok(route.length > 0);
    const end = route.at(-1);
    assert.ok(Math.hypot(end.x - 17, end.z - z) < 0.36);
  }
  for (const point of [
    [-2.5, 3],
    [20.5, 3],
    [4, -0.5],
    [4, 8.5],
  ]) {
    assert.equal(engine.isBlocked(...point), true);
  }
});

test("changing floor recomputes the footprint from that floor only", () => {
  const engine = layout([makeRoom("a", 0, 0), makeRoom("b", 10, 0)]);
  engine.rooms = [makeRoom("c", 30, 40, 5, 5.4)];
  engine.updatePlan();
  assert.deepEqual(engine.planBounds, {
    minX: 29.65,
    maxX: 35.35,
    minZ: 39.65,
    maxZ: 47.4,
  });
});

test("demo keeps its established navigation plan", () => {
  const engine = layout([makeRoom("a", 0, 0)]);
  engine.isLive = false;
  engine.updatePlan();
  assert.notEqual(engine.planWidth, 8.2);
  assert.notDeepEqual(engine.walkBounds, [{ ...engine.planBounds }]);
});

test("all floor kinds receive the same clear corridor surfaces and right edge", () => {
  for (const floor of [0, 1]) {
    const room = makeRoom("a", 0, 0);
    room.floorIndex = floor;
    room.kind = floor ? "personal" : "channel";
    const engine = layout([room]);
    engine.activeFloor = floor;
    engine.addLiveGround();
    assert.ok(engine.staticGroup.getObjectByName("live-corridor-floor"));
    const right = engine.staticGroup.getObjectByName(
      "live-right-corridor-edge"
    );
    assert.ok(right);
    assert.ok(
      Math.abs(
        right.position.x +
          right.geometry.parameters.width / 2 -
          engine.planBounds.maxX
      ) < 1e-8
    );
  }
});

test("all forty private-office doors remain reachable without heavy gap infill", () => {
  const rooms = Array.from({ length: 40 }, (_, index) =>
    makeRoom(
      `office-${index}`,
      1.2 + (index % 10) * 5 + (index % 10 >= 5 ? 2 : 0),
      1 + Math.floor(index / 10) * 7.4,
      5,
      5.4
    )
  );
  const engine = layout(rooms);
  engine.addLiveWalls();
  engine.rebuildColliders();
  assert.equal(
    engine.buildingGroup.children.some(
      (node) => node.name === "live-office-block-join"
    ),
    false
  );
  for (const room of rooms) {
    const goal = {
      x: room.bounds.x + room.bounds.w / 2,
      z: room.bounds.z + room.bounds.d - 1.1,
    };
    const route = engine.findPath(27.2, 29.5, goal.x, goal.z);
    assert.ok(
      route.length,
      `${room.id} should be reachable from the front corridor`
    );
    assert.ok(
      Math.hypot(route.at(-1).x - goal.x, route.at(-1).z - goal.z) < 0.36
    );
  }
});

test("touching offices share one normal-thickness dividing wall", () => {
  const engine = layout([makeRoom("a", 0, 0), makeRoom("b", 8, 0)]);
  engine.addLiveWalls();
  const dividers = engine.buildingGroup.children.filter(
    (node) =>
      node.geometry?.parameters?.width === 0.14 &&
      node.position.x === 8 &&
      node.position.z === 3
  );
  assert.equal(dividers.length, 1);
  assert.equal(dividers[0].geometry.parameters.depth, 6);
});

test("internal block corridor replaces outside routes without sealing doorways", () => {
  const engine = layout([makeRoom("a", 0, 0), makeRoom("b", 10, 0)]);
  engine.addLiveWalls();
  engine.rebuildColliders();
  assert.equal(engine.isBlocked(-1, 3), true);
  assert.equal(engine.isBlocked(19, 3), true);
  assert.equal(engine.isBlocked(9, 3), false);
  assert.ok(engine.findPath(9, 7, 9, 1).length);
});

test("the enlarged three-room row keeps both corridors and all doors reachable", () => {
  const width = (31 - 0.8 - 4) / 3;
  const rooms = Array.from({ length: 3 }, (_, index) => {
    const room = makeRoom(
      `channel-${index}`,
      0.8 + index * (width + 2),
      22,
      width,
      7.4
    );
    room.kind = "channel";
    return room;
  });
  const engine = layout(rooms);
  engine.addLiveWalls();
  engine.rebuildColliders();
  for (const room of rooms) {
    const x = room.bounds.x + width / 2;
    assert.ok(engine.findPath(15.9, 30.4, x, 28.2).length);
  }
  for (const x of [0.8 + width + 1, 0.8 + 2 * width + 3]) {
    assert.ok(engine.findPath(x, 30.4, x, 22.5).length);
  }
});

test("enlarged meeting pair retains routes to reception and both focus rooms", () => {
  const specs = [
    ["reception", 9, 1, 7, 6],
    ["lounge", 1, 8.6, 8, 6],
    ["meeting", 18, 1, 7, 6],
    ["meeting", 25, 1, 7, 6],
    ["focus", 18, 9, 4, 4],
    ["focus", 24, 9, 4, 4],
    ["focus", 18, 15, 4, 4],
    ["focus", 24, 15, 4, 4],
  ];
  const rooms = specs.map(([kind, x, z, w, d], index) => ({
    ...makeRoom(`shared-${index}`, x, z, w, d),
    kind,
  }));
  const engine = layout(rooms);
  engine.addLiveWalls();
  engine.rebuildColliders();
  const partition = engine.buildingGroup.children.filter(
    (node) =>
      node.position.x === 25 &&
      node.position.z === 4 &&
      node.geometry?.parameters.width === 0.14
  );
  assert.equal(partition.length, 1);
  for (const [x, z] of [
    [13, 5.4],
    [28.5, 5.4],
    [26, 11.8],
    [26, 17.8],
  ]) {
    assert.ok(
      engine.findPath(21.5, 5.4, x, z).length,
      `route to ${x},${z} must remain open`
    );
  }
});

test("aligned focus rows keep a continuous centre and cross corridor", () => {
  const rooms = [
    makeRoom("a", 18, 9, 4, 4),
    makeRoom("b", 24, 9, 4, 4),
    makeRoom("c", 18, 15, 4, 4),
    makeRoom("d", 24, 15, 4, 4),
  ];
  rooms.forEach((room) => {
    room.kind = "focus";
  });
  const engine = layout(rooms);
  engine.addLiveWalls();
  engine.rebuildColliders();
  assert.ok(engine.findPath(23, 10, 23, 20).length);
  assert.ok(engine.findPath(19, 14, 27, 14).length);
});

test("the full reception-to-meeting corridor remains walkable", () => {
  const reception = { ...makeRoom("reception", 9, 1, 7, 6), kind: "reception" };
  const meeting = { ...makeRoom("meeting", 18, 1, 7, 6), kind: "meeting" };
  const engine = layout([reception, meeting]);
  engine.addLiveWalls();
  engine.rebuildColliders();
  for (const x of [16.5, 17, 17.5]) {
    assert.ok(engine.findPath(x, 2, x, 7.5).length);
  }
  assert.ok(engine.findPath(21.5, 5.4, 12.5, 5.4).length);
});

test("outer wall faces stay clear of both boundary lines without adding a walking strip", () => {
  const engine = layout([makeRoom("a", 0, 0), makeRoom("b", 10, 0)]);
  engine.addLiveGround();
  const left = engine.staticGroup.getObjectByName("live-side-corridor-edge");
  const right = engine.staticGroup.getObjectByName("live-right-corridor-edge");
  const leftGap =
    -0.07 - (left.position.x + left.geometry.parameters.width / 2);
  const rightGap =
    right.position.x - right.geometry.parameters.width / 2 - 18.07;
  assert.ok(leftGap >= 0.2 - 1e-8);
  assert.ok(rightGap >= 0.2 - 1e-8);
  assert.equal(engine.isBlocked(-0.2, 3), true);
  assert.equal(engine.isBlocked(18.2, 3), true);
});

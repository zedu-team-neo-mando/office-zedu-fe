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

function harness(floor = 0) {
  const engine = Object.create(OfficeEngine.prototype);
  const target = new THREE.Vector3(6, 0, 0);
  let invalid = 0;
  engine.activeFloor = floor;
  engine.rooms = [
    {
      id: "room",
      kind: floor ? "personal" : "focus",
      floorIndex: floor,
      bounds: { x: 3, z: 2, w: 5, d: 6 },
    },
  ];
  engine.allRooms = engine.rooms;
  engine.walkBounds = [{ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }];
  engine.planBounds = engine.walkBounds[0];
  engine.colliders = [];
  engine.playerPosition = new THREE.Vector3(-6, 0, 0);
  engine.pointerDown = true;
  engine.pointerDragged = false;
  engine.view = "floor";
  engine.editState = { active: false };
  engine.cinematic = false;
  engine.updatePointer = () => {};
  engine.seatUnderPointer = () => null;
  engine.raycaster = {
    setFromCamera() {},
    intersectObject: () => [{ point: target }],
  };
  engine.callbacks = { onInvalidTarget: () => invalid++ };
  engine.path = [];
  engine.pathIndex = 7;
  engine.pendingSeat = {};
  engine.showMarker = (x, z) => {
    engine.marked = { x, z };
  };
  return {
    engine,
    target,
    invalid: () => invalid,
    click: () => engine.onPointerUp({ button: 0 }),
  };
}

for (const floor of [0, 1]) {
  test(`reachable unnamed corridor on floor ${floor} starts walking`, () => {
    const h = harness(floor);
    assert.equal(h.engine.roomAtPosition(h.target.x, h.target.z), null);
    h.click();
    assert.equal(h.invalid(), 0);
    assert.ok(h.engine.path.length > 0);
    assert.deepEqual(h.engine.path.at(-1), { x: 6, z: 0 });
    assert.equal(h.engine.pathIndex, 0);
    assert.equal(h.engine.pendingSeat, null);
    assert.deepEqual(h.engine.marked, { x: 6, z: 0 });
  });
}

test("named rooms remain reachable and room detection is retained", () => {
  const h = harness();
  h.target.set(6, 0, 4);
  h.click();
  assert.equal(h.invalid(), 0);
  assert.ok(h.engine.path.length);
  assert.equal(h.engine.roomAtPosition(6, 4).id, "room");
});

for (const obstacle of ["outside", "locked room", "locked room edge"]) {
  test(`clicking ${obstacle} is rejected without replacing the route`, () => {
    const h = harness();
    const previous = [{ x: -5, z: 0 }];
    h.engine.path = previous;
    if (obstacle === "outside") h.target.set(40, 0, 0);
    else {
      h.engine.rooms[0].locked = true;
      h.target.set(obstacle === "locked room edge" ? 3.1 : 6, 0, 4);
    }
    h.click();
    assert.equal(h.invalid(), 1);
    assert.equal(h.engine.path, previous);
    assert.equal(h.engine.marked, undefined);
  });
}

test("reachable corridor path goes around a wall rather than through it", () => {
  const h = harness();
  h.engine.colliders = [{ minX: -0.2, maxX: 0.2, minZ: -10, maxZ: 2 }];
  h.click();
  assert.equal(h.invalid(), 0);
  assert.ok(h.engine.path.some((point) => point.z > 2));
  h.engine.path.forEach((point, index, route) => {
    assert.equal(h.engine.isBlocked(point.x, point.z), false);
    if (index)
      assert.equal(h.engine.lineOfSight(route[index - 1], point), true);
  });
});

test("a corridor beyond an impassable wall still reports no route", () => {
  const h = harness();
  h.engine.colliders = [{ minX: -0.2, maxX: 0.2, minZ: -10, maxZ: 10 }];
  h.click();
  assert.equal(h.invalid(), 1);
  assert.deepEqual(h.engine.path, []);
});

test("ordinary movement still uses the same collision guard", () => {
  const h = harness();
  h.engine.resolveMove(1, 0);
  assert.equal(h.engine.playerPosition.x, -5);
  h.engine.colliders = [{ minX: -4.5, maxX: -3, minZ: -1, maxZ: 1 }];
  h.engine.resolveMove(1, 0);
  assert.equal(h.engine.playerPosition.x, -5);
});

for (const obstacle of [
  "furniture",
  "wall",
  "wall-adjacent floor",
  "floor edge",
]) {
  test(`clicking ${obstacle} snaps to a nearby safe position`, () => {
    const h = harness();
    if (obstacle === "floor edge") h.target.set(9.9, 0, 0);
    else if (obstacle === "furniture")
      h.engine.colliders = [{ minX: 5, maxX: 7, minZ: -1, maxZ: 1 }];
    else {
      h.engine.colliders = [{ minX: 5.9, maxX: 6.1, minZ: -2, maxZ: 2 }];
      if (obstacle === "wall-adjacent floor") h.target.set(5.7, 0, 0);
    }
    assert.equal(h.engine.isBlocked(h.target.x, h.target.z), true);
    h.click();
    assert.equal(h.invalid(), 0);
    assert.ok(h.engine.path.length > 0);
    const destination = h.engine.path.at(-1);
    assert.notDeepEqual(destination, { x: h.target.x, z: h.target.z });
    assert.equal(h.engine.isBlocked(destination.x, destination.z, 0.28), false);
    assert.ok(
      Math.hypot(destination.x - h.target.x, destination.z - h.target.z) <= 3
    );
    h.engine.path.forEach((point, index, route) => {
      if (index)
        assert.equal(h.engine.lineOfSight(route[index - 1], point), true);
    });
  });
}

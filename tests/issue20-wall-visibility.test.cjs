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

function harness() {
  const engine = Object.create(OfficeEngine.prototype);
  Object.assign(engine, {
    buildingGroup: new THREE.Group(),
    wallColliders: [],
    occlusionWalls: [],
    camera: new THREE.PerspectiveCamera(),
    playerPosition: new THREE.Vector3(0, 0, 0),
    playerRig: {},
    cameraYaw: 0,
    view: "floor",
    cinematic: false,
    allRooms: [],
    activeFloor: 0,
    walkBounds: [{ minX: -20, maxX: 20, minZ: -20, maxZ: 20 }],
  });
  engine.camera.position.set(0, 5, 8);
  return engine;
}

test("only foreground walls fade and shared palette materials stay opaque", () => {
  const e = harness();
  const palette = new THREE.MeshStandardMaterial();
  const foreground = e.addWallBox(0, 3, 4, 0.2, palette, 4);
  const behind = e.addWallBox(0, -3, 4, 0.2, palette, 4);
  const beside = e.addWallBox(8, 3, 4, 0.2, palette, 4);
  e.updateWallOcclusion(0.1);
  assert.ok(foreground.material.opacity < 1);
  assert.equal(foreground.material.transparent, true);
  assert.equal(foreground.material.depthWrite, false);
  for (const material of [behind.material, beside.material, palette]) {
    assert.equal(material.opacity, 1);
    assert.equal(material.transparent, false);
  }
});

test("camera rotation restores walls and fades the new obstruction", () => {
  const e = harness();
  const material = new THREE.MeshStandardMaterial();
  const front = e.addWallBox(0, 3, 4, 0.2, material, 4);
  const back = e.addWallBox(0, -3, 4, 0.2, material, 4);
  e.updateWallOcclusion(0.1);
  e.camera.position.set(0, 5, -8);
  e.cameraYaw = Math.PI;
  for (let i = 0; i < 40; i++) e.updateWallOcclusion(0.05);
  assert.equal(front.material.opacity, 1);
  assert.equal(front.material.transparent, false);
  assert.equal(front.material.depthWrite, true);
  assert.ok(back.material.opacity >= 0.35);
  assert.ok(back.material.opacity < 0.36);
});

test("faded walls retain collision and still block walking", () => {
  const e = harness();
  e.addWallBox(0, 3, 4, 0.2, new THREE.MeshStandardMaterial(), 4);
  const before = structuredClone(e.wallColliders);
  e.colliders = e.wallColliders;
  e.updateWallOcclusion(0.1);
  assert.deepEqual(e.wallColliders, before);
  assert.equal(e.isBlocked(0, 3), true);
  assert.equal(e.lineOfSight({ x: 0, z: 2 }, { x: 0, z: 4 }), false);
});

test("a camera inside a wall fades it, while glass keeps its existing material", () => {
  const e = harness();
  const wall = e.addWallBox(0, 3, 4, 0.2, new THREE.MeshStandardMaterial(), 4);
  const glass = new THREE.MeshPhysicalMaterial({
    transparent: true,
    opacity: 0.24,
  });
  const pane = e.addWallBox(0, 2, 4, 0.1, glass, 4, false);
  e.camera.position.set(0, 2, 3);
  e.updateWallOcclusion(0.1);
  assert.ok(wall.material.opacity < 1);
  assert.equal(e.occlusionWalls.length, 1);
  assert.equal(pane.material, glass);
  assert.equal(glass.opacity, 0.24);
});

for (const mode of ["tower", "cinematic"]) {
  test(`${mode} restores opaque walls`, () => {
    const e = harness();
    const wall = e.addWallBox(
      0,
      3,
      4,
      0.2,
      new THREE.MeshStandardMaterial(),
      4
    );
    e.updateWallOcclusion(0.1);
    if (mode === "tower") e.view = "tower";
    else e.cinematic = true;
    for (let i = 0; i < 40; i++) e.updateWallOcclusion(0.05);
    assert.equal(wall.material.opacity, 1);
    assert.equal(wall.material.transparent, false);
    assert.equal(wall.material.depthWrite, true);
  });
}

test("a low foreground partition fades when it crosses only the lower body", () => {
  const e = harness();
  e.camera.position.set(0, 1.4, 6);
  const wall = e.addWallBox(
    0,
    1,
    4,
    0.2,
    new THREE.MeshStandardMaterial(),
    0.8
  );
  e.updateWallOcclusion(0.1);
  assert.ok(wall.material.opacity < 1);
});

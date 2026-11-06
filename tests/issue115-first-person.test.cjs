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

function sourceAst(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(path.join(folder, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

function functionSource(ast, name) {
  let found = null;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, `${name} must exist`);
  return found.getText(ast);
}

function compileFunction(source, parameters) {
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function(
    ...parameters,
    code + `; return ${source.match(/function (\w+)/)[1]};`
  );
}

function harness() {
  const engine = Object.create(OfficeEngine.prototype);
  engine.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 240);
  engine.playerPosition = new THREE.Vector3(4, 0, -2);
  engine.cameraPosition = new THREE.Vector3(8.5, 7, 18);
  engine.cameraTarget = new THREE.Vector3(8.5, 1.1, 9.4);
  engine.cameraYaw = 0;
  engine.cameraPitch = 0.86;
  engine.cameraDistance = 9;
  engine.lookPitch = 0;
  engine.firstPerson = false;
  engine.cinematic = false;
  engine.view = "floor";
  engine.seated = { id: "chair" };
  engine.pendingSeat = { id: "sofa" };
  engine.playerRig = { group: new THREE.Group() };
  engine.playerRig.group.visible = true;
  engine.occlusionWalls = [];
  engine.path = [];
  engine.pointerDown = false;
  engine.pointerDragged = false;
  return engine;
}

test("First person hides the body and stands the player up", () => {
  const engine = harness();
  engine.setFirstPerson(true);

  assert.equal(engine.firstPerson, true);
  assert.equal(engine.playerRig.group.visible, false);
  assert.equal(engine.seated, null);
  assert.equal(engine.pendingSeat, null);
});

test("First person puts the eye on the player at 1.66", () => {
  const engine = harness();
  engine.setFirstPerson(true);
  engine.updateCamera(0.016);

  assert.equal(engine.camera.position.x, 4);
  assert.equal(engine.camera.position.y, 1.66);
  assert.equal(engine.camera.position.z, -2);
});

test("The look direction follows yaw and look pitch", () => {
  const engine = harness();
  engine.setFirstPerson(true);
  engine.cameraYaw = Math.PI / 2;
  engine.updateCamera(0.016);

  const flat = new THREE.Vector3();
  engine.camera.getWorldDirection(flat);
  assert.ok(Math.abs(flat.x + 1) < 1e-6, `x was ${flat.x}`);
  assert.ok(Math.abs(flat.y) < 1e-6, `y was ${flat.y}`);
  assert.ok(Math.abs(flat.z) < 1e-6, `z was ${flat.z}`);

  engine.lookPitch = 1.1;
  engine.updateCamera(0.016);
  const up = new THREE.Vector3();
  engine.camera.getWorldDirection(up);
  assert.ok(Math.abs(up.y - Math.sin(1.1)) < 1e-6, `y was ${up.y}`);
});

test("Mouse-look turns the head and clamps at 83 degrees", () => {
  const engine = harness();
  engine.setFirstPerson(true);

  engine.lookBy(400, 0, 0.0022, 0.0022);
  assert.ok(
    Math.abs(engine.cameraYaw + 0.88) < 1e-9,
    `yaw ${engine.cameraYaw}`
  );

  engine.lookBy(0, -10000, 0.0022, 0.0022);
  assert.equal(engine.lookPitch, 1.45);
  engine.lookBy(0, 20000, 0.0022, 0.0022);
  assert.equal(engine.lookPitch, -1.45);
});

test("The wheel does not zoom the eye, and works again on exit", () => {
  const engine = harness();
  const event = { preventDefault() {}, deltaY: 300 };
  engine.setFirstPerson(true);
  engine.onWheel(event);
  assert.equal(engine.cameraDistance, 9);

  engine.setFirstPerson(false);
  engine.onWheel(event);
  assert.ok(engine.cameraDistance > 9, "third person still zooms");
});

test("Clicking the floor does not walk or sit in first person", () => {
  const engine = harness();
  let marked = 0;
  engine.showMarker = () => {
    marked += 1;
  };
  engine.setFirstPerson(true);
  engine.pointerDown = true;
  engine.onPointerUp({ button: 0 });

  assert.equal(marked, 0);
  assert.deepEqual(engine.path, []);
});

test("Leaving first person restores the body and the orbit pitch", () => {
  const engine = harness();
  engine.setFirstPerson(true);
  engine.lookPitch = 0.7;
  engine.setFirstPerson(false);

  assert.equal(engine.playerRig.group.visible, true);
  assert.equal(engine.lookPitch, 0);
});

test("A late pointer lock is released after first person is left", () => {
  const engine = harness();
  const canvas = {};
  const notifications = [];
  engine.renderer = { domElement: canvas };
  engine.callbacks = {
    onMouseLook: (active) => notifications.push(active),
  };

  const oldDocument = global.document;
  let exits = 0;
  global.document = {
    pointerLockElement: canvas,
    exitPointerLock: () => {
      exits += 1;
    },
  };

  try {
    engine.onPointerLockChange();
  } finally {
    global.document = oldDocument;
  }

  assert.equal(exits, 1);
  assert.deepEqual(notifications, []);
});

test("Pointer-lock changes still report the mouse-look state", () => {
  const engine = harness();
  const canvas = {};
  const notifications = [];
  engine.renderer = { domElement: canvas };
  engine.callbacks = {
    onMouseLook: (active) => notifications.push(active),
  };
  engine.firstPerson = true;

  const oldDocument = global.document;
  global.document = { pointerLockElement: canvas, exitPointerLock() {} };

  try {
    engine.onPointerLockChange();
    global.document.pointerLockElement = null;
    engine.onPointerLockChange();
  } finally {
    global.document = oldDocument;
  }

  assert.deepEqual(notifications, [true, false]);
});

test("Mobile cannot enter first person with V, but can still leave it", () => {
  const createToggle = compileFunction(
    functionSource(sourceAst("OfficeDemo.tsx"), "toggleFirstPerson"),
    ["stateRef", "setFirstPersonView"]
  );
  const calls = [];
  const stateRef = {
    current: {
      isMobile: true,
      firstPerson: false,
      chatOpen: false,
      editorActive: false,
      towerOpen: false,
      zoeOpen: false,
      directoryOpen: false,
      onboardingOpen: false,
      avatarOpen: false,
      tourStep: null,
    },
  };
  const toggle = createToggle(stateRef, (next) => calls.push(next));

  toggle();
  assert.deepEqual(calls, [], "mobile must not enter first person");

  stateRef.current.firstPerson = true;
  toggle();
  assert.deepEqual(calls, [false], "mobile must still be able to leave");

  stateRef.current.isMobile = false;
  stateRef.current.firstPerson = false;
  toggle();
  assert.deepEqual(calls, [false, true], "desktop still enters");

  stateRef.current.avatarOpen = true;
  toggle();
  assert.deepEqual(calls, [false, true], "avatar dialog blocks the toggle");

  stateRef.current.avatarOpen = false;
  stateRef.current.tourStep = 0;
  toggle();
  assert.deepEqual(calls, [false, true], "tour blocks the toggle");

  stateRef.current.tourStep = null;
  toggle();
  assert.deepEqual(calls, [false, true, true], "desktop can enter again");
});

test("First person falls back to drag look without pointer lock", () => {
  const engine = harness();
  engine.renderer = { domElement: {} };

  assert.doesNotThrow(() => engine.setFirstPerson(true));
  assert.equal(engine.firstPerson, true);
});

test("Walls stop fading away once the eye is the camera", () => {
  const engine = harness();
  const material = new THREE.MeshBasicMaterial({
    opacity: 0.35,
    transparent: true,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  engine.occlusionWalls = [
    {
      mesh,
      bounds: new THREE.Box3(
        new THREE.Vector3(3, -1, -3),
        new THREE.Vector3(5, 3, -1)
      ),
      depthWrite: true,
    },
  ];
  engine.setFirstPerson(true);
  engine.updateCamera(0.016);
  for (let frame = 0; frame < 40; frame += 1) {
    engine.updateWallOcclusion(0.016);
  }

  assert.ok(material.opacity > 0.99, `opacity was ${material.opacity}`);
});

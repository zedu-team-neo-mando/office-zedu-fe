const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const THREE = require("three");

const folder = path.join(__dirname, "../src/app/office/_components");
function compile(source, overrides = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  new Function("require", "module", "exports", code)(
    (id) => (Object.hasOwn(overrides, id) ? overrides[id] : require(id)),
    module,
    module.exports
  );
  return module.exports;
}
const source = fs.readFileSync(
  path.join(folder, "engine/OfficeEngine.ts"),
  "utf8"
);
const { OfficeEngine } = compile(source, {
  "../office-data": compile(
    fs.readFileSync(path.join(folder, "office-data.ts"), "utf8")
  ),
  "../office-layout": compile(
    fs.readFileSync(path.join(folder, "office-layout.ts"), "utf8"),
    {
      "./office-data": compile(
        fs.readFileSync(path.join(folder, "office-data.ts"), "utf8")
      ),
    }
  ),
  "./palette": compile(
    fs.readFileSync(path.join(folder, "engine/palette.ts"), "utf8")
  ),
  "./tower-scene": {},
});
const ast = ts.createSourceFile(
  "OfficeEngine.ts",
  source,
  ts.ScriptTarget.Latest,
  true
);
const declaration = ast.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name.text === "OfficeEngine"
);
const loop = declaration.members.find(
  (node) => node.name?.getText(ast) === "loop"
);
const frameCode = ts.transpileModule(
  "function frame() " + loop.initializer.body.getText(ast),
  {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }
).outputText;
const frame = new Function(
  "requestAnimationFrame",
  frameCode + "; return frame;"
)(() => 0);

function harness(t) {
  const oldDocument = global.document;
  t.after(() => {
    global.document = oldDocument;
  });
  const engine = Object.create(OfficeEngine.prototype);
  const canvas = {
    getBoundingClientRect: () => ({
      left: 10,
      top: 20,
      width: 200,
      height: 100,
    }),
  };
  let hitTarget = canvas;
  global.document = { elementFromPoint: () => hitTarget };
  const lounge = { roomId: "lounge", name: "Lounge", floorIndex: 0 };
  const office = { roomId: "personal:hi", name: "hi", floorIndex: 1 };
  const emitted = [];
  const highlighted = [];
  let picked = lounge;
  Object.assign(engine, {
    view: "tower",
    pointerDown: false,
    pointerDragged: false,
    pointerNdc: new THREE.Vector2(),
    towerPointer: null,
    towerHover: null,
    occlusionWalls: [],
    camera: new THREE.PerspectiveCamera(),
    cameraDistance: 10,
    clock: { getDelta: () => 0.016, elapsedTime: 1 },
    cinemaTime: 0,
    renderer: { domElement: canvas, render: () => {} },
    scene: {},
    callbacks: {
      onTowerHover: (room) => emitted.push(room),
      onTowerPick: () => assert.fail("Hover must not select a conversation"),
    },
    tower: {
      pick: () => picked,
      setHovered: (id) => highlighted.push(id),
      update: () => {},
      focusRoom: () => {},
      focusFloor: () => {},
      pulse: () => {},
      group: { visible: true },
    },
    updateTowerCamera: () => {},
    applyBackdrop: () => {},
    buildingGroup: {},
    staticGroup: {},
    furnitureGroup: {},
    avatarGroup: {},
    ghostGroup: {},
  });
  const move = () => engine.onPointerMove({ clientX: 110, clientY: 70 });
  return {
    engine,
    lounge,
    office,
    emitted,
    highlighted,
    move,
    pick: (room) => {
      picked = room;
    },
    cover: () => {
      hitTarget = {};
    },
    tick: () => frame.call(engine),
  };
}

test("room, floor and search focus clear the previous office label and highlight", (t) => {
  const h = harness(t);
  for (const focus of [
    () => h.engine.focusTowerRoom("personal:hi"),
    () => h.engine.focusTowerFloor(1),
    () => h.engine.pulseOffice("personal:hi", 1),
  ]) {
    h.move();
    assert.equal(h.emitted.at(-1), h.lounge);
    focus();
    assert.equal(h.emitted.at(-1), null);
    assert.equal(h.highlighted.at(-1), null);
  }
});

test("stationary pointer is picked after camera animation, without changing the conversation", (t) => {
  const h = harness(t);
  h.move();
  h.engine.updateTowerCamera = () => h.pick(h.office);
  h.tick();
  assert.equal(h.emitted.at(-1), h.office);
  assert.equal(h.highlighted.at(-1), h.office.roomId);
});

test("unchanged targets do not publish a React hover update every frame", (t) => {
  const h = harness(t);
  h.move();
  const count = h.emitted.length;
  h.tick();
  h.tick();
  assert.equal(h.emitted.length, count);
});

test("a HUD overlay under the stationary pointer clears the old label", (t) => {
  const h = harness(t);
  h.move();
  h.cover();
  h.tick();
  assert.equal(h.emitted.at(-1), null);
});

test("switching to floor view clears the tower label", (t) => {
  const h = harness(t);
  h.move();
  h.engine.setView("floor");
  assert.equal(h.emitted.at(-1), null);
});

test("dragging suppresses hover until the pointer is released", (t) => {
  const h = harness(t);
  h.move();
  h.engine.pointerDown = true;
  h.tick();
  assert.equal(h.emitted.at(-1), null);
  h.engine.pointerDown = false;
  h.pick(h.office);
  h.tick();
  assert.equal(h.emitted.at(-1), h.office);
});

test("raycasting sees the updated camera world matrix before render", (t) => {
  const h = harness(t);
  h.move();
  h.engine.updateTowerCamera = () => h.engine.camera.position.set(12, 0, 0);
  h.engine.tower.pick = () =>
    h.engine.camera.matrixWorld.elements[12] === 12 ? h.office : h.lounge;
  h.tick();
  assert.equal(h.emitted.at(-1), h.office);
});

test("stationary pointer coordinates follow canvas resizing", (t) => {
  const h = harness(t);
  h.move();
  h.engine.renderer.domElement.getBoundingClientRect = () => ({
    left: 10,
    top: 20,
    width: 400,
    height: 100,
  });
  h.engine.tower.pick = (ndc) => (ndc.x < -0.25 ? h.office : h.lounge);
  h.tick();
  assert.equal(h.emitted.at(-1), h.office);
});

test("search preview cannot restore a hover label after the engine clears it", (t) => {
  const h = harness(t);
  h.move();
  let uiHover = h.lounge;
  h.engine.callbacks.onTowerHover = (office) => {
    uiHover = office;
  };
  const pageSource = fs.readFileSync(
    path.join(folder, "OfficeDemo.tsx"),
    "utf8"
  );
  const pageAst = ts.createSourceFile(
    "OfficeDemo.tsx",
    pageSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let selection;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "pickTowerPerson")
      selection = node;
    ts.forEachChild(node, visit);
  }
  visit(pageAst);
  assert.ok(selection, "Search preview handler must exist");
  const code = ts.transpileModule(selection.getText(pageAst), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  let previewed = null;
  const select = new Function(
    "engineRef",
    "roomById",
    "towerPreview",
    "setTowerHover",
    "setTowerFocus",
    "setTowerPreview",
    "setChatOpen",
    "setLiftTarget",
    "schedule",
    "diveIntoRoom",
    "showInfo",
    code + "; return pickTowerPerson;"
  )(
    { current: h.engine },
    { [h.office.roomId]: { locked: false } },
    null,
    (office) => {
      uiHover = office;
    },
    () => {},
    (id) => {
      previewed = id;
    },
    () => {},
    () => {},
    () => {},
    () => assert.fail("First search selection must not enter the office"),
    () => {}
  );
  select(h.office);
  h.cover();
  h.tick();
  assert.equal(uiHover, null);
  assert.equal(previewed, h.office.roomId);
});

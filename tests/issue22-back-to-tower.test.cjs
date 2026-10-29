const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const componentDir = path.join(__dirname, "../src/app/office/_components");

function loadComponent(file, overrides = {}) {
  const source = fs.readFileSync(path.join(componentDir, file), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (id) => (Object.hasOwn(overrides, id) ? overrides[id] : require(id)),
    module,
    module.exports
  );
  return module.exports;
}

function sourceAst(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(path.join(componentDir, file), "utf8"),
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

function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}

function buttonsIn(node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    node.forEach((child) => buttonsIn(child, found));
    return found;
  }
  if (node.type === "button") found.push(node);
  buttonsIn(node.props?.children, found);
  return found;
}

function renderHud(overrides = {}) {
  const { default: Hud } = loadComponent("Hud.tsx", {
    "~/lib/utils": { cn: (...classes) => classes.filter(Boolean).join(" ") },
  });
  return Hud({
    room: null,
    rooms: [],
    onlineCount: 1,
    presenceState: "live",
    currentRoomId: null,
    player: { x: 0, z: 0, yaw: 0 },
    presence: [],
    avatar: { tint: "#a78bfa" },
    selfName: "Test User",
    selfRole: "Tester",
    nearZoe: false,
    unread: 0,
    chatOpen: false,
    editorOpen: false,
    isMobile: false,
    mapOpen: false,
    onToggleMap: () => {},
    onOpenDirectory: () => {},
    onOpenAvatar: () => {},
    onOpenTower: () => {},
    onToggleChat: () => {},
    onToggleEditor: () => {},
    onHelp: () => {},
    onExit: () => {},
    onNavigate: () => {},
    onInteract: () => {},
    ...overrides,
  });
}

test("floor HUD labels Back to tower and keeps Leave office separate", () => {
  let openedTower = 0;
  let leftOffice = 0;
  const found = buttonsIn(
    renderHud({
      onOpenTower: () => openedTower++,
      onExit: () => leftOffice++,
    })
  );
  const back = found.find((button) =>
    textOf(button).replace(/\s+/g, " ").trim().includes("Back to tower")
  );
  const leave = found.find(
    (button) => button.props["aria-label"] === "Leave office"
  );

  assert.ok(back, "Back to tower must be a visible button");
  assert.equal(back.props.type, "button");
  assert.equal(back.props["aria-label"], "Back to tower");
  assert.equal(back.props.title, "Back to tower");
  assert.ok(back.props.className.includes("office-return-button"));

  assert.ok(leave, "Leave office must remain its own control");
  assert.notStrictEqual(back, leave);

  back.props.onClick();
  assert.equal(openedTower, 1);
  assert.equal(leftOffice, 0);

  leave.props.onClick();
  assert.equal(leftOffice, 1);
  assert.equal(openedTower, 1);
});

test("Back to tower switches the existing office view without leaving it", () => {
  const createOpenTower = compileFunction(
    functionSource(sourceAst("OfficeDemo.tsx"), "openTower"),
    [
      "engineRef",
      "setActiveFloor",
      "setTowerFocus",
      "setTowerPreview",
      "setTowerOpen",
      "setMapOpen",
      "setDirectoryOpen",
      "setChatOpen",
    ]
  );
  const calls = [];
  const engine = {
    getActiveFloor: () => 3,
    setView: (view) => calls.push(["view", view]),
    focusTowerFloor: (floor) => calls.push(["focusTowerFloor", floor]),
  };
  const openTower = createOpenTower(
    { current: engine },
    (floor) => calls.push(["activeFloor", floor]),
    (floor) => calls.push(["towerFocus", floor]),
    (preview) => calls.push(["towerPreview", preview]),
    (open) => calls.push(["towerOpen", open]),
    (open) => calls.push(["mapOpen", open]),
    (open) => calls.push(["directoryOpen", open]),
    (open) => calls.push(["chatOpen", open])
  );
  openTower();

  assert.deepEqual(calls, [
    ["activeFloor", 3],
    ["view", "tower"],
    ["focusTowerFloor", null],
    ["towerFocus", null],
    ["towerPreview", null],
    ["towerOpen", true],
    ["mapOpen", false],
    ["directoryOpen", false],
    ["chatOpen", false],
  ]);
});

test("Leave office still returns to the organisation's 2D view", () => {
  const createExitDemo = compileFunction(
    functionSource(sourceAst("OfficeDemo.tsx"), "exitDemo"),
    [
      "onExit",
      "setTourStep",
      "setChatOpen",
      "setZoeOpen",
      "setAvatarOpen",
      "setDirectoryOpen",
      "closeEditor",
      "router",
    ]
  );
  const calls = [];
  const exitDemo = createExitDemo(
    () => calls.push("onExit"),
    () => calls.push("tour"),
    () => calls.push("chat"),
    () => calls.push("zoe"),
    () => calls.push("avatar"),
    () => calls.push("directory"),
    () => calls.push("editor"),
    { push: (href) => calls.push(["push", href]) }
  );
  exitDemo();

  assert.deepEqual(calls, ["onExit"]);

  const liveOffice = fs.readFileSync(
    path.join(
      __dirname,
      "../src/app/(client)/[org]/_components/office/live-office-page.tsx"
    ),
    "utf8"
  );
  assert.match(
    liveOffice,
    /onExit=\{\(\) => router\.push\(`\/\$\{orgSlug\}`\)\}/
  );
});

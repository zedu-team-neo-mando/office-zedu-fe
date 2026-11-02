const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

const filename = path.join(
  __dirname,
  "..",
  "src",
  "app",
  "office",
  "_components",
  "OfficeDemo.tsx"
);
const text = fs.readFileSync(filename, "utf8");
const ast = ts.createSourceFile(
  filename,
  text,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const component = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "OfficeDemo"
);
const statements = component.body.statements;
const permission = statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations[0].name.getText(ast) === "canEditRoom"
);
const effect = statements.find(
  (node) =>
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(ast) === "useEffect" &&
    node.getText(ast).includes("source.saveLayout")
).expression.arguments[0];
const names = [
  "commitRoom",
  "undo",
  "redo",
  "closeEditor",
  "toggleEditor",
  "publishLayout",
];
const functions = statements.filter(
  (node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
);
assert.equal(functions.length, names.length);
const code = ts.transpileModule(
  permission.getText(ast) +
    "\n" +
    functions.map((node) => node.getText(ast)).join("\n") +
    "\nglobalThis.effect = " +
    effect.getText(ast) +
    ";\nglobalThis.permission = canEditRoom;",
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }
).outputText;

function harness({ admin = false, mode = "live", save } = {}) {
  const timers = new Map();
  const calls = [];
  const errors = [];
  let timerId = 0;
  const own = { id: "personal:me", kind: "personal", ownerId: "me" };
  const shared = { id: "reception", kind: "reception" };
  const guest = { id: "personal:other", kind: "personal", ownerId: "other" };
  const context = {
    hydrated: true,
    selfId: "me",
    canEditShared: mode === "demo" || admin,
    useCallback: (callback) => callback,
    roomById: { [own.id]: own, [shared.id]: shared, [guest.id]: guest },
    currentRoom: own,
    layouts: { [own.id]: [], [shared.id]: [] },
    stateRef: { current: { roomId: own.id, layouts: {}, editorActive: true } },
    dirtyLayoutsRef: { current: new Map() },
    queuedLayoutsRef: { current: new Map() },
    saveQueueRef: { current: Promise.resolve() },
    canEditRoomRef: { current: null },
    undoStack: [],
    redoStack: [],
    window: {
      setTimeout(callback, delay) {
        assert.equal(delay, 500);
        timers.set(++timerId, callback);
        return timerId;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    source: {
      mode,
      async saveLayout(roomId, items) {
        calls.push([roomId, items]);
        await save?.(roomId, items);
      },
    },
    setSaveState(value) {
      context.saveState = value;
    },
    saveState: "saved",
    setLayouts(update) {
      context.layouts = update(context.layouts);
      context.stateRef.current.layouts = context.layouts;
    },
    recordHistory() {},
    showError(...args) {
      errors.push(args);
    },
    showInfo() {},
    showSuccess() {},
    setUndoStack(update) {
      context.undoStack = update(context.undoStack);
    },
    setRedoStack(update) {
      context.redoStack = update(context.redoStack);
    },
  };
  for (const name of [
    "EditorActive",
    "EditorCatalogId",
    "EditorMovingId",
    "EditorRotation",
    "SelectedFurnitureId",
    "GhostReason",
    "ChatOpen",
    "ZoeOpen",
    "DirectoryOpen",
    "OnboardingOpen",
  ]) {
    context["set" + name] = () => {};
  }
  context.stateRef.current.layouts = context.layouts;
  vm.runInNewContext(code, context);
  context.canEditRoomRef.current = context.permission;
  let cleanup;
  return {
    context,
    calls,
    errors,
    own,
    shared,
    guest,
    render() {
      cleanup?.();
      cleanup = context.effect();
    },
    runTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
    async flush() {
      this.runTimers();
      await context.saveQueueRef.current;
    },
    navigate(room) {
      context.currentRoom = room;
      context.stateRef.current.roomId = room.id;
    },
  };
}
const furniture = (x) => [
  { id: "desk", catalogId: "desk", x, z: 1, rotation: 0 },
];

test("entry, hydration and room navigation never save an untouched layout", async () => {
  const h = harness();
  h.render();
  h.navigate(h.shared);
  h.render();
  h.context.layouts = { [h.own.id]: furniture(2) };
  h.render();
  await h.flush();
  assert.equal(h.calls.length, 0);
  assert.equal(h.context.saveState, "saved");
});

test("autosave keeps the edited room when the player moves away", async () => {
  const h = harness();
  const items = furniture(2);
  h.context.commitRoom(h.own.id, items);
  h.render();
  h.navigate(h.shared);
  await h.flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], h.own.id);
  assert.equal(h.calls[0][1], items);
  assert.equal(h.context.saveState, "saved");
});

test("members cannot edit shared or other people's rooms; admins and demo can edit shared rooms", async () => {
  for (const options of [{}, { admin: true }, { mode: "demo" }]) {
    const h = harness(options);
    h.context.commitRoom(h.guest.id, furniture(1));
    h.context.commitRoom(h.shared.id, furniture(2));
    h.render();
    await h.flush();
    assert.equal(
      h.calls.length,
      options.admin || options.mode === "demo" ? 1 : 0
    );
    if (h.calls.length) {
      assert.equal(h.calls[0][0], h.shared.id);
      assert.equal(h.context.saveState, "draft");
    }
    assert.equal(h.context.permission({ ...h.own, locked: true }), false);
  }
});

test("unchanged layouts and cancelled debounce timers do not cause writes", async () => {
  const h = harness();
  h.context.commitRoom(h.own.id, []);
  h.render();
  await h.flush();
  assert.equal(h.calls.length, 0);
  h.context.commitRoom(h.own.id, furniture(1));
  h.render();
  const latest = furniture(2);
  h.context.commitRoom(h.own.id, latest);
  h.render();
  await h.flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][1], latest);
});

test("failed saves stay unsaved after closing and reopening, and the next edit retries", async () => {
  let fail = true;
  const h = harness({
    save: async () => {
      if (fail) throw new Error("save rejected");
    },
  });
  h.context.commitRoom(h.own.id, furniture(1));
  h.render();
  await h.flush();
  assert.equal(h.context.saveState, "draft");
  assert.equal(h.errors.length, 1);
  assert.equal(h.context.dirtyLayoutsRef.current.size, 1);
  h.context.closeEditor();
  h.context.toggleEditor();
  assert.equal(h.context.saveState, "draft");
  fail = false;
  h.context.commitRoom(h.own.id, furniture(2));
  h.render();
  await h.flush();
  assert.equal(h.context.saveState, "saved");
  assert.equal(h.context.dirtyLayoutsRef.current.size, 0);
});

test("undo and redo are persisted as edits", async () => {
  const h = harness();
  const old = furniture(1);
  const next = furniture(2);
  h.context.layouts[h.own.id] = next;
  h.context.undoStack = [old];
  h.context.undo();
  h.render();
  await h.flush();
  assert.equal(h.calls[0][1], old);
  h.context.redo();
  h.render();
  await h.flush();
  assert.equal(h.calls[1][1], next);
});

test("a new edit waits for the in-flight save and cannot be marked saved early", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let first = true;
  const h = harness({
    save: async () => {
      if (first) {
        first = false;
        await pending;
      }
    },
  });
  h.context.commitRoom(h.own.id, furniture(1));
  h.render();
  h.runTimers();
  await Promise.resolve();
  const latest = furniture(2);
  h.context.commitRoom(h.own.id, latest);
  h.render();
  h.runTimers();
  assert.equal(h.calls.length, 1);
  assert.notEqual(h.context.saveState, "saved");
  release();
  await h.context.saveQueueRef.current;
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1][1], latest);
  assert.equal(h.context.saveState, "saved");
});

test("queued writes recheck permission before sending", async () => {
  const h = harness();
  h.context.commitRoom(h.own.id, furniture(1));
  h.render();
  h.runTimers();
  h.context.canEditRoomRef.current = () => false;
  await h.context.saveQueueRef.current;
  assert.equal(h.calls.length, 0);
});

test("publishing cancels the pending draft and serializes later edits", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const h = harness({ admin: true });
  h.navigate(h.shared);
  h.context.source.publishLayout = async () => pending;
  h.context.commitRoom(h.shared.id, furniture(1));
  h.render();
  h.context.publishLayout();
  h.runTimers();
  await Promise.resolve();
  const latest = furniture(2);
  h.context.commitRoom(h.shared.id, latest);
  h.render();
  h.runTimers();
  assert.equal(h.calls.length, 0);
  release();
  await h.context.saveQueueRef.current;
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][1], latest);
  assert.equal(h.context.saveState, "draft");
});

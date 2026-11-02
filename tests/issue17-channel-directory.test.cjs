const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

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

const data = loadComponent("office-data.ts");
const template = data.ROOMS.find((room) => room.kind === "channel");

function directoryRows(rooms, query = "") {
  const { RoomDirectory } = loadComponent("Panels.tsx", {
    react: {
      ...React,
      useState: () => [query, () => {}],
      useMemo: (calculate) => calculate(),
    },
    "./office-data": data,
    "~/components/ui/dialog": {},
    "~/lib/utils": { cn: (...classes) => classes.filter(Boolean).join(" ") },
  });
  const navigated = [];
  const tree = RoomDirectory({
    open: true,
    rooms,
    currentRoomId: null,
    presence: [],
    playerRoomId: null,
    onClose: () => {},
    onNavigate: (id) => navigated.push(id),
  });
  const rows = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type?.name === "RoomRow") rows.push(node);
    visit(node.props?.children);
  }
  visit(tree);
  return { rows, navigated };
}

test("directory lists every live channel without searching or demo IDs", () => {
  const channels = Array.from({ length: 6 }, (_, index) => ({
    ...template,
    id: `channel:00000000-0000-4000-8000-00000000000${index}`,
    refId: `00000000-0000-4000-8000-00000000000${index}`,
    name: `Team channel ${index}`,
  }));
  const { rows } = directoryRows(channels);
  assert.deepEqual(
    rows.map((row) => row.props.room.id),
    channels.map((room) => room.id)
  );
});

test("private channel keeps its lock and navigates using its original room ID", () => {
  const room = {
    ...template,
    id: "channel:private-channel-id",
    refId: "private-channel-id",
    name: "Private planning",
    locked: true,
  };
  const { rows, navigated } = directoryRows([room]);
  assert.equal(rows.length, 1);
  assert.strictEqual(rows[0].props.room, room);
  assert.match(renderToStaticMarkup(rows[0].type(rows[0].props)), /locked/);
  rows[0].props.onNavigate();
  assert.deepEqual(navigated, [room.id]);
});

test("demo channels remain visible and empty payload adds no channel rooms", () => {
  const channels = data.ROOMS.filter((room) => room.kind === "channel");
  assert.deepEqual(
    directoryRows(data.ROOMS)
      .rows.filter((row) => row.props.room.kind === "channel")
      .map((row) => row.props.room.id),
    channels.map((room) => room.id)
  );
  assert.equal(directoryRows([]).rows.length, 0);
});

test("search still returns the real channel room", () => {
  const room = { ...template, id: "channel:real-id", name: "Engineering" };
  const { rows } = directoryRows([room], "engineer");
  assert.deepEqual(
    rows.map((row) => row.props.room.id),
    [room.id]
  );
});

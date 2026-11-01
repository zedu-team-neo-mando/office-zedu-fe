const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");

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
const SELF = "usr-self";
const LOUNGE = data.ROOMS.find((room) => room.kind === "lounge");
const FOCUS = data.ROOMS.find((room) => room.kind === "focus");

function point(id, roomId, name = id) {
  return { id, name, roomId, x: 0, z: 0, status: "online" };
}

function directoryRows(presence, playerRoomId, rooms = data.ROOMS) {
  const { RoomDirectory } = loadComponent("Panels.tsx", {
    react: {
      ...React,
      useState: () => ["", () => {}],
      useMemo: (calculate) => calculate(),
    },
    "./office-data": data,
    "~/components/ui/dialog": {},
    "~/lib/utils": { cn: (...classes) => classes.filter(Boolean).join(" ") },
  });
  const tree = RoomDirectory({
    open: true,
    rooms,
    currentRoomId: playerRoomId,
    presence,
    playerRoomId,
    selfId: SELF,
    onClose: () => {},
    onNavigate: () => {},
  });
  const rows = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type?.name === "RoomRow") rows.push(node);
    visit(node.props?.children);
  }
  visit(tree);
  return rows;
}

function peopleIn(rows, roomId) {
  const row = rows.find((entry) => entry.props.room.id === roomId);
  assert.ok(row, `the directory should list ${roomId}`);
  return row.props.people;
}

// Presence carries the requester's own record, so the directory used to add
// the player on top of it and show 2 people in a room the HUD called "1 here".
test("an empty room lists the requester once, not twice", () => {
  const rows = directoryRows([point(SELF, LOUNGE.id)], LOUNGE.id);
  assert.equal(peopleIn(rows, LOUNGE.id), 1);
});

test("a colleague in the room is still counted next to the requester", () => {
  const rows = directoryRows(
    [point(SELF, LOUNGE.id), point("usr-colleague", LOUNGE.id)],
    LOUNGE.id
  );
  assert.equal(peopleIn(rows, LOUNGE.id), 2);
});

// Focus pods hold one person: the requester alone must read 1, not 2.
test("a single-occupancy focus pod reads one while the requester is alone", () => {
  const rows = directoryRows([point(SELF, FOCUS.id)], FOCUS.id);
  assert.equal(peopleIn(rows, FOCUS.id), 1);
});

test("other rooms keep counting their occupants without the requester", () => {
  const otherFocus = data.ROOMS.filter((room) => room.kind === "focus").find(
    (room) => room.id !== FOCUS.id
  );
  const rows = directoryRows(
    [
      point(SELF, LOUNGE.id),
      point("usr-colleague", otherFocus.id),
      point("usr-second", otherFocus.id),
    ],
    LOUNGE.id
  );
  assert.equal(peopleIn(rows, otherFocus.id), 2);
});

// Everyone who reads presence has to drop the requester: Zoe described the
// lonely user as "1 nearby" and sent them to the model as a nearby person.
test("othersInRoom never returns the requester", () => {
  assert.deepEqual(
    data.othersInRoom([point(SELF, LOUNGE.id)], LOUNGE.id, SELF),
    []
  );

  const withColleague = data.othersInRoom(
    [point(SELF, LOUNGE.id), point("usr-colleague", LOUNGE.id)],
    LOUNGE.id,
    SELF
  );
  assert.deepEqual(
    withColleague.map((entry) => entry.id),
    ["usr-colleague"]
  );
});

test("othersInRoom ignores the corridor and other rooms", () => {
  assert.deepEqual(data.othersInRoom([point(SELF, LOUNGE.id)], null, SELF), []);
  assert.deepEqual(
    data.othersInRoom([point("usr-colleague", FOCUS.id)], LOUNGE.id, SELF),
    []
  );
});

// The HUD, the directory and Zoe's nearby context must agree, which only
// holds while all three read the same helper.
test("the HUD, the directory and Zoe agree on the occupancy count", () => {
  const presence = [
    point(SELF, LOUNGE.id),
    point("usr-colleague", LOUNGE.id),
    point("usr-lobby", "lobby"),
  ];
  const rows = directoryRows(presence, LOUNGE.id);
  const hudCount =
    data.othersInRoom(
      presence.filter((entry) => entry.roomId !== "lobby"),
      LOUNGE.id,
      SELF
    ).length + 1;
  const zoeNearby = data.othersInRoom(presence, LOUNGE.id, SELF).length;

  assert.equal(peopleIn(rows, LOUNGE.id), hudCount);
  assert.equal(zoeNearby, hudCount - 1);
});

test("OfficeDemo renders the directory with the requester's identity", () => {
  const source = fs.readFileSync(
    path.join(componentDir, "OfficeDemo.tsx"),
    "utf8"
  );
  assert.match(source, /<RoomDirectory[\s\S]*?selfId=\{selfId\}/);
  assert.match(source, /othersInRoom\(presence, roomId, selfId\)/);
});

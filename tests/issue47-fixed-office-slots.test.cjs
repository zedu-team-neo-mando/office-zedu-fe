const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const folder = path.join(__dirname, "../src/app/office/_components/engine");
function load(file, overrides = {}) {
  const source = fs.readFileSync(path.join(folder, file), "utf8");
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
const { TowerScene } = load("tower-scene.ts", {
  "./palette": load("palette.ts"),
});
const people = Array.from({ length: 40 }, (_, index) => ({
  roomId: "personal:member-" + index,
  name: "Member " + index,
  floorIndex: 1,
  kind: "personal",
  present: index === 0,
}));
function layout(offices, kind = "member") {
  const scene = Object.create(TowerScene.prototype);
  const floor = { index: 1, kind, capacity: 40, members: offices.length };
  const cells = [];
  const vacant = [];
  scene.buildVacantCell = (rect) => vacant.push(rect);
  scene.floors = [floor];
  scene.buildOfficeCell = (office, rect) => cells.push({ office, rect });
  scene.buildFloorCells(floor, offices);
  return { scene, cells, vacant };
}

const { towerOfficePage, towerPageOffices } = load("tower-pages.ts");

test("both exterior pages together show all forty exactly once", () => {
  const first = towerPageOffices(people, 0);
  const second = towerPageOffices(people, 1);
  assert.equal(first.length, 20);
  assert.equal(second.length, 20);
  assert.deepEqual([...first, ...second], people);
  for (const page of [first, second]) {
    const { cells } = layout(page);
    assert.equal(cells.length, 20);
    assert.equal(new Set(cells.map((cell) => cell.rect.col)).size, 10);
    assert.equal(new Set(cells.map((cell) => cell.rect.row)).size, 2);
  }
});

test("each person's page reveals them, including positions twenty and twenty-one", () => {
  people.forEach((person, index) => {
    const page = towerOfficePage(people, person);
    assert.equal(page, index < 20 ? 0 : 1);
    assert.ok(towerPageOffices(people, page).includes(person));
  });
});

test("slots fill bottom-to-top and stay fixed as the floor grows", () => {
  const full = layout(towerPageOffices(people, 0)).cells;
  assert.deepEqual(
    full.slice(0, 3).map(({ rect }) => [rect.col, rect.row]),
    [
      [0, 0],
      [0, 1],
      [1, 0],
    ]
  );
  for (const count of [0, 1, 2, 3, 12, 20, 21, 39, 40]) {
    const subset = towerPageOffices(people.slice(0, count), 0);
    const { cells } = layout(subset);
    assert.equal(cells.length, Math.min(20, count));
    cells.forEach((cell, index) =>
      assert.deepEqual(cell.rect, full[index].rect)
    );
  }
});

test("normal slots retain original tower dimensions and clear the entrance", () => {
  const { scene, cells } = layout(people.slice(0, 20));
  assert.equal(scene.width, 30);
  for (const { rect } of cells) {
    assert.ok(rect.w >= 2.6);
    assert.ok(Math.abs(rect.h - 2.1) < 1e-8);
    assert.ok(rect.x + rect.w / 2 <= scene.width / 2 - 2 - 0.6 - 0.04);
  }
});

test("paging keeps shared rooms and counts member positions separately on each floor", () => {
  const shared = { roomId: "lounge", kind: "lounge", floorIndex: 0 };
  const other = people.map((person) => ({
    ...person,
    roomId: person.roomId + "-floor2",
    floorIndex: 2,
  }));
  const all = [shared, ...people, ...other];
  const page = towerPageOffices(all, 1);
  assert.ok(page.includes(shared));
  assert.equal(page.length, 41);
  assert.ok(page.includes(people[20]));
  assert.ok(page.includes(other[20]));
  assert.equal(
    all.length,
    81,
    "full directory remains available for inside floors and search"
  );
});

test("unused exterior slots are boarded without creating fake offices", () => {
  for (const count of [0, 1, 3, 19, 20]) {
    const { cells, vacant } = layout(people.slice(0, count));
    assert.equal(cells.length, count);
    assert.equal(vacant.length, 20 - count);
    const slots = [...cells.map((cell) => cell.rect), ...vacant];
    assert.equal(
      new Set(slots.map((rect) => `${rect.col}:${rect.row}`)).size,
      20
    );
    assert.ok(slots.every((rect) => rect.x + rect.w / 2 < 12.4));
  }
});

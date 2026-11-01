// Office telemetry tracker tests — runs with `node --test`
// Mocks browser storage/beacon so the pure tracker module can be tested offline.

// --- Browser storage mocks ---------------------------------------------------
const sessionStore = new Map();
const localStore = new Map();

global.sessionStorage = {
  getItem: (k) => sessionStore.get(k) ?? null,
  setItem: (k, v) => sessionStore.set(k, String(v)),
  removeItem: (k) => sessionStore.delete(k),
  clear: () => sessionStore.clear(),
};

global.localStorage = {
  getItem: (k) => localStore.get(k) ?? null,
  setItem: (k, v) => localStore.set(k, String(v)),
  removeItem: (k) => localStore.delete(k),
  clear: () => localStore.clear(),
};

// --- fetch mock --------------------------------------------------------------
global.capturedPayloads = [];
let fetchShouldFail = false;
let fetchOk = true;

global.fetch = async (_url, init) => {
  if (fetchShouldFail) throw new Error("network down");
  const body = JSON.parse(init.body);
  global.capturedPayloads.push(body);
  return {
    ok: fetchOk,
    status: fetchOk ? 202 : 500,
  };
};

// --- sendBeacon mock ---------------------------------------------------------
let beaconPayload = null;

global.navigator = {
  sendBeacon: (_url, body) => {
    beaconPayload = JSON.parse(body);
    return true;
  },
};

process.env.NEXT_PUBLIC_FF_OFFICE_ANALYTICS = "true";

const { test } = require("node:test");

async function loadTracker() {
  const mod = await import("../src/lib/office/telemetry.ts");
  mod.resetTrackerForTests();
  return new mod.TelemetryTracker();
}

function fail(msg) {
  throw new Error(msg);
}

// --- tests -------------------------------------------------------------------
test("session id is created and persisted in sessionStorage", async () => {
  sessionStore.clear();
  const t = await loadTracker();
  const sid = sessionStore.get("office_telemetry_session_id");
  if (!(typeof sid === "string" && sid.length > 0))
    fail("session id persisted");
  t.stop();
});

test("session.start event is recorded on start()", async () => {
  sessionStore.clear();
  localStore.clear();
  global.capturedPayloads = [];
  const t = await loadTracker();
  t.start({
    sessionId: "sess-1",
    mode: "live",
    entryPoint: "lobby",
    startedAt: Date.now(),
  });
  await t.flush();
  if (global.capturedPayloads.length !== 1) fail("one batch flushed");
  const ev = global.capturedPayloads[0].events[0];
  if (ev.kind !== "session.start") fail("first event is session.start");
  if (global.capturedPayloads[0].session.sessionId !== "sess-1")
    fail("session id matches");
  t.stop();
});

test("room.enter recorded on entering a room", async () => {
  sessionStore.clear();
  localStore.clear();
  global.capturedPayloads = [];
  const t = await loadTracker();
  t.start({
    sessionId: "sess-2",
    mode: "live",
    entryPoint: "lobby",
    startedAt: Date.now(),
  });
  t.roomChanged("reception", "reception", "reception", 0, "walk");
  await t.flush();
  const all = global.capturedPayloads.flatMap((p) => p.events);
  const enter = all.filter((e) => e.kind === "room.enter");
  if (enter.length !== 1) fail("room.enter recorded");
  if (enter[0].roomRef !== "reception") fail("room ref matches");
  t.stop();
});

test("room.leave recorded with dwellMs when leaving a room", async () => {
  sessionStore.clear();
  localStore.clear();
  global.capturedPayloads = [];
  const t = await loadTracker();
  t.start({
    sessionId: "sess-3",
    mode: "live",
    entryPoint: "lobby",
    startedAt: Date.now(),
  });
  t.roomChanged("reception", "reception", "reception", 0, "walk");
  const origNow = Date.now;
  Date.now = () => origNow() + 500;
  t.roomChanged("lounge", "lounge", "lounge", 0, "walk");
  Date.now = origNow;
  await t.flush();
  const all = global.capturedPayloads.flatMap((p) => p.events);
  const leave = all.filter((e) => e.kind === "room.leave");
  if (leave.length !== 1) fail("room.leave recorded");
  if (!(leave[0].dwellMs >= 0)) fail("dwellMs present");
  t.stop();
});

test("corridor (null room) never creates a room.enter", async () => {
  sessionStore.clear();
  localStore.clear();
  global.capturedPayloads = [];
  const t = await loadTracker();
  t.start({
    sessionId: "sess-4",
    mode: "live",
    entryPoint: "lobby",
    startedAt: Date.now(),
  });
  t.roomChanged(null, "", "", 0, "walk");
  await t.flush();
  const all = global.capturedPayloads.flatMap((p) => p.events);
  const enters = all.filter((e) => e.kind === "room.enter");
  if (enters.length !== 0) fail("no room.enter for corridor");
  t.stop();
});

test("portal.cross recorded", async () => {
  sessionStore.clear();
  localStore.clear();
  global.capturedPayloads = [];
  const t = await loadTracker();
  t.start({
    sessionId: "sess-5",
    mode: "live",
    entryPoint: "lobby",
    startedAt: Date.now(),
  });
  t.portalCross("portal-a");
  await t.flush();
  const all = global.capturedPayloads.flatMap((p) => p.events);
  const crosses = all.filter((e) => e.kind === "portal.cross");
  if (crosses.length !== 1) fail("portal.cross recorded");
  t.stop();
});

test("tower.open closes current room dwell", async () => {
  sessionStore.clear();
  localStore.clear();
  global.capturedPayloads = [];
  const t = await loadTracker();
  t.start({
    sessionId: "sess-6",
    mode: "live",
    entryPoint: "lobby",
    startedAt: Date.now(),
  });
  t.roomChanged("reception", "reception", "reception", 0, "walk");
  const origNow = Date.now;
  Date.now = () => origNow() + 300;
  t.towerOpened();
  Date.now = origNow;
  await t.flush();
  const all = global.capturedPayloads.flatMap((p) => p.events);
  const leaves = all.filter((e) => e.kind === "room.leave");
  if (leaves.length !== 1) fail("room.leave on tower open");
  if (!(leaves[0].dwellMs > 0)) fail("dwell captured before tower");
  t.stop();
});

test("tower.close resumes room detection", async () => {
  sessionStore.clear();
  localStore.clear();
  global.capturedPayloads = [];
  const t = await loadTracker();
  t.start({
    sessionId: "sess-7",
    mode: "live",
    entryPoint: "lobby",
    startedAt: Date.now(),
  });
  t.towerOpened();
  t.towerClosed();
  t.roomChanged("focus:1", "focus", "focus:1", 2, "walk");
  await t.flush();
  const all = global.capturedPayloads.flatMap((p) => p.events);
  const enters = all.filter((e) => e.kind === "room.enter");
  const focusEnter = enters.find((e) => e.roomRef === "focus:1");
  if (!focusEnter) fail("room.enter after tower close");
  t.stop();
});

test("teleport arrival tags via: tower", async () => {
  sessionStore.clear();
  localStore.clear();
  global.capturedPayloads = [];
  const t = await loadTracker();
  t.start({
    sessionId: "sess-8",
    mode: "live",
    entryPoint: "lobby",
    startedAt: Date.now(),
  });
  t.teleportArrive("personal:ada", "personal", "personal:ada", 3, "tower");
  await t.flush();
  const all = global.capturedPayloads.flatMap((p) => p.events);
  const enters = all.filter((e) => e.kind === "room.enter");
  if (enters[0].via !== "tower") fail("teleport via tower");
  t.stop();
});

test("queue capped at 100 events", async () => {
  sessionStore.clear();
  localStore.clear();
  global.capturedPayloads = [];
  global.fetchShouldFail = true; // flushes fail, queue builds up
  const t = await loadTracker();
  t.start({
    sessionId: "sess-9",
    mode: "live",
    entryPoint: "lobby",
    startedAt: Date.now(),
  });
  for (let i = 0; i < 150; i++) {
    t.roomChanged(`room-${i % 10}`, "meeting", `room-${i % 10}`, 0, "walk");
  }
  if (t.queueLength() > 100)
    fail(`queue capped at 100, got ${t.queueLength()}`);
  global.fetchShouldFail = false;
  t.stop();
});

test("batch flushes at 25 events", async () => {
  sessionStore.clear();
  localStore.clear();
  global.capturedPayloads = [];
  const t = await loadTracker();
  t.start({
    sessionId: "sess-10",
    mode: "live",
    entryPoint: "lobby",
    startedAt: Date.now(),
  });
  for (let i = 0; i < 50; i++) {
    t.roomChanged(`room-${i}`, "meeting", `room-${i}`, 0, "walk");
  }
  await t.flush();
  if (!(global.capturedPayloads.length >= 2))
    fail("at least 2 batches for 50 events");
  t.stop();
});

test("unknown event kinds are skipped, not rejected", async () => {
  sessionStore.clear();
  localStore.clear();
  global.capturedPayloads = [];
  const t = await loadTracker();
  t.start({
    sessionId: "sess-11",
    mode: "live",
    entryPoint: "lobby",
    startedAt: Date.now(),
  });
  // Record an unknown kind directly through the private method.
  t["record"]({
    kind: "unknown.kind",
    offsetMs: 0,
    floorIndex: 0,
    roomKind: "",
    roomRef: "",
    dwellMs: 0,
    via: "",
  });
  await t.flush();
  const all = global.capturedPayloads.flatMap((p) => p.events);
  const kinds = all.map((e) => e.kind);
  if (kinds.includes("unknown.kind")) fail("unknown kinds never recorded");
  t.stop();
});

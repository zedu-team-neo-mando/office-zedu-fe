const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const THREE = require("three");
const root = path.join(__dirname, "../src");
function load(file, overrides = {}, cache = new Map()) {
  const full = path.resolve(root, file);
  if (cache.has(full)) return cache.get(full);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(full, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  new Function("require", "module", "exports", code)(
    (id) => {
      if (Object.hasOwn(overrides, id)) return overrides[id];
      if (id.startsWith("~/") || id.startsWith(".")) {
        const target = id.startsWith("~/")
          ? path.join(root, id.slice(2))
          : path.resolve(path.dirname(full), id);
        return load(
          path.relative(
            root,
            [target + ".ts", target + ".tsx"].find(fs.existsSync)
          ),
          overrides,
          cache
        );
      }
      return require(id);
    },
    module,
    module.exports
  );
  cache.set(full, module.exports);
  return module.exports;
}
function sourceHarness(status = "away") {
  const writes = [],
    socketWrites = [],
    handlers = {};
  const subscription = {
    on: (event, fn) => {
      handlers[event] = fn;
    },
    off() {},
    publish: async (payload) => {
      socketWrites.push(payload);
    },
    subscribe() {},
    state: "unsubscribed",
  };
  const requests = {
    GetRequest: async () => ({
      status: 200,
      data: { data: [{ userId: "self", roomId: "reception", status }] },
    }),
    PostRequest: async (url, payload) => {
      writes.push({ url, payload });
      return { status: 200, data: { data: {} } };
    },
    BuzzRequest: async (url, payload) => {
      writes.push({ url, payload });
      return { status: 200 };
    },
  };
  const { LiveOfficeSource } = load(
    "app/(client)/[org]/_components/office/live-office-source.ts",
    {
      "~/utils/new-request": requests,
      "~/lib/zoe/request-contract": {},
      "~/lib/centrifugo/shared-centrifuge": {
        getSharedCentrifuge: () => ({}),
        getSubscriptionToken: () => "test",
        prepareChannelSubscription: () => subscription,
        releaseChannelSubscription() {},
      },
    }
  );
  const source = new LiveOfficeSource();
  source.userId = "self";
  source.rooms = [
    { id: "reception", kind: "reception" },
    { id: "focus:1", kind: "focus" },
    { id: "focus:2", kind: "focus" },
  ];
  return { source, writes, socketWrites, subscription, handlers, requests };
}
for (const previous of ["online", "away", "call", "dnd"]) {
  test(`Focus entries and movements publish DND and restore ${previous}`, async () => {
    const { source, writes, handlers } = sourceHarness(previous);
    const stop = source.subscribePresence("reception", () => {});
    handlers.subscribed();
    await new Promise(setImmediate);
    await source.enterRoom("focus:1");
    assert.equal(writes.at(-1).payload.status, "dnd");
    await source.sendPosition("focus:1", 19, 10, 0);
    assert.equal(writes.at(-1).payload.status, "dnd");
    await source.enterRoom("focus:2");
    assert.equal(writes.at(-1).payload.status, "dnd");
    await source.enterRoom("reception");
    assert.equal(writes.at(-1).payload.status, previous);
    await source.sendPosition("reception", 12, 3, 0);
    assert.equal(writes.at(-1).payload.status, previous);
    stop();
  });
}
for (const previous of ["online", "away", "call"]) {
  test(`WebSocket presence carries DND and restores ${previous}`, async () => {
    const { source, socketWrites, subscription } = sourceHarness(previous);
    source.previousPresenceStatus = previous;
    source.presenceSubscription = subscription;
    subscription.state = "subscribed";
    source.presenceRoomId = "focus:1";
    await source.enterRoom("focus:1");
    await source.sendPosition("focus:1", 19, 10, 0);
    assert.ok(socketWrites.length >= 3);
    assert.ok(socketWrites.every((event) => event.presence.status === "dnd"));
    source.presenceRoomId = "reception";
    await source.enterRoom("reception");
    await source.sendPosition("reception", 12, 3, 0);
    assert.equal(socketWrites.at(-1).presence.status, previous);
  });
}

const { OfficeEngine } = load("app/office/_components/engine/OfficeEngine.ts", {
  "./tower-scene": {},
});
function engineHarness(live = true) {
  const e = Object.create(OfficeEngine.prototype);
  Object.assign(e, {
    isLive: live,
    playerStatus: "away",
    beforeFocusStatus: null,
    playerRig: null,
    selfId: "self",
    agentRigs: new Map(),
    avatarGroup: new THREE.Group(),
  });
  return e;
}
test("live avatar waits for confirmed DND and restores status on leaving or changing Focus pods", () => {
  const e = engineHarness();
  e.updatePlayerRoomStatus({ kind: "focus" });
  assert.equal(e.playerStatus, "away");
  e.setOccupants([{ userId: "self", status: "dnd" }]);
  assert.equal(e.playerStatus, "dnd");
  e.updatePlayerRoomStatus({ kind: "focus" });
  e.updatePlayerRoomStatus(null);
  assert.equal(e.playerStatus, "away");
  assert.equal(e.beforeFocusStatus, null);
});
test("demo Focus state still works without a backend", () => {
  const e = engineHarness(false);
  e.updatePlayerRoomStatus({ kind: "focus" });
  assert.equal(e.playerStatus, "dnd");
  e.updatePlayerRoomStatus({ kind: "lounge" });
  assert.equal(e.playerStatus, "online");
});
test("confirmed status refreshes nameplate and ring and disposes the old material", () => {
  const e = engineHarness();
  const group = new THREE.Group();
  const label = new THREE.Sprite(new THREE.SpriteMaterial());
  label.userData.nameplate = {
    name: "You",
    status: "online",
    tint: "#123456",
    isPlayer: true,
    isZoe: false,
  };
  label.position.y = 2.13;
  group.add(label);
  let disposed = false;
  label.material.addEventListener("dispose", () => {
    disposed = true;
  });
  e.makeNameplate = (name, status) => {
    const next = new THREE.Sprite();
    next.userData.nameplate = { name, status };
    return next;
  };
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(),
    new THREE.MeshBasicMaterial()
  );
  const rig = { group, ring };
  e.updateRigStatus(rig, "dnd");
  assert.equal(group.children[0].userData.nameplate.status, "dnd");
  assert.equal(group.children[0].position.y, 2.13);
  assert.equal(disposed, true);
});
test("DND toast requires the current user's confirmed Focus presence", () => {
  const file = path.join(root, "app/office/_components/OfficeDemo.tsx");
  const text = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const component = ast.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "OfficeDemo"
  );
  const declaration = component.body.statements
    .filter(ts.isVariableStatement)
    .flatMap((n) => [...n.declarationList.declarations])
    .find((n) => n.name.getText(ast) === "mergePresence");
  const callback = declaration.initializer.arguments[0].getText(ast);
  const code = ts.transpileModule("const fn = " + callback, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const toasts = [];
  const stateRef = { current: { roomId: "focus:1" } };
  const merge = new Function(
    "setPresence",
    "engineRef",
    "selfId",
    "roomById",
    "confirmedFocusRef",
    "showInfo",
    "stateRef",
    code + ";return fn;"
  )(
    () => {},
    { current: { setOccupants() {} } },
    "self",
    { "focus:1": { kind: "focus" } },
    { current: null },
    (...args) => toasts.push(args),
    stateRef
  );
  const occupant = { userId: "self", roomId: "focus:1", status: "online" };
  merge([occupant]);
  assert.equal(toasts.length, 0);
  merge([{ ...occupant, status: "dnd" }]);
  assert.equal(toasts.length, 1);
  merge([{ ...occupant, status: "dnd" }]);
  assert.equal(toasts.length, 1);
  stateRef.current.roomId = "reception";
  merge([{ ...occupant, status: "dnd" }]);
  assert.equal(toasts.length, 1);
});

for (const [status, colour] of [
  ["online", "#34d399"],
  ["call", "#60a5fa"],
  ["dnd", "#f43f5e"],
  ["away", "#94a3b8"],
]) {
  test(`own map marker reflects ${status} and keeps its identity outline`, () => {
    const { renderToStaticMarkup } = require("react-dom/server");
    const { Minimap } = load("app/office/_components/Hud.tsx", {
      "~/lib/utils": { cn: (...classes) => classes.filter(Boolean).join(" ") },
    });
    const html = renderToStaticMarkup(
      Minimap({
        rooms: [],
        currentRoomId: null,
        player: { x: 1, z: 2, yaw: 0 },
        selfStatus: status,
        presence: [],
        onNavigate() {},
        onClose() {},
      })
    );
    const marker = html.match(
      /<circle[^>]*r="0.62"[^>]*>[\s\S]*?<\/circle>/
    )?.[0];
    assert.ok(marker, "own marker is present");
    assert.ok(marker.includes(`fill="${colour}"`));
    assert.ok(marker.includes('stroke="#ffffff"'));
    assert.ok(marker.includes(status === "dnd" ? "Do not disturb" : status));
  });
}

for (const previous of ["away", "call"]) {
  test(`initial entry waits for the existing ${previous} status before any write`, async () => {
    const { source, requests, writes, socketWrites, handlers, subscription } =
      sourceHarness(previous);
    let resolveSnapshot;
    const snapshot = new Promise((resolve) => {
      resolveSnapshot = resolve;
    });
    requests.GetRequest = () => snapshot;
    subscription.state = "subscribed";
    const stop = source.subscribePresence("reception", () => {});
    const entry = source.enterRoom("reception");
    await new Promise(setImmediate);
    assert.equal(writes.length, 0);
    assert.equal(socketWrites.filter((event) => event.presence).length, 0);
    resolveSnapshot({
      status: 200,
      data: {
        data: [{ userId: "self", roomId: "reception", status: previous }],
      },
    });
    await entry;
    assert.equal(writes.at(-1).payload.status, previous);
    assert.ok(
      socketWrites
        .filter((event) => event.presence)
        .every((event) => event.presence.status === previous)
    );
    await source.enterRoom("focus:1");
    await source.enterRoom("reception");
    assert.equal(writes.at(-1).payload.status, previous);
    stop();
  });
}

test("demo Focus exit uses the destination room status in both directions", () => {
  const e = engineHarness(false);
  for (const kind of ["reception", "focus", "meeting", "focus", "reception"]) {
    e.updatePlayerRoomStatus({ kind });
    assert.equal(
      e.playerStatus,
      kind === "focus" ? "dnd" : kind === "meeting" ? "call" : "online"
    );
  }
});

test("demo map fallback agrees with Focus, meeting and reception statuses", () => {
  const text = fs.readFileSync(
    path.join(root, "app/office/_components/OfficeDemo.tsx"),
    "utf8"
  );
  const ast = ts.createSourceFile(
    "OfficeDemo.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let expression;
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "selfStatus")
      expression = node.initializer.expression.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const status = new Function(
    "presence",
    "selfId",
    "source",
    "currentRoom",
    `return (${expression});`
  );
  for (const [kind, expected] of [
    ["focus", "dnd"],
    ["meeting", "call"],
    ["reception", "online"],
  ]) {
    assert.equal(status([], "self", { mode: "demo" }, { kind }), expected);
  }
  assert.equal(
    status(
      [{ id: "self", status: "away" }],
      "self",
      { mode: "live" },
      { kind: "meeting" }
    ),
    "away"
  );
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
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
        const resolved = [target + ".ts", target + ".tsx"].find(fs.existsSync);
        return load(path.relative(root, resolved), overrides, cache);
      }
      return require(id);
    },
    module,
    module.exports
  );
  cache.set(full, module.exports);
  return module.exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const data = load("app/office/_components/office-data.ts");
async function sourceHarness() {
  const calls = [];
  const request = {
    GetRequest: async (url) => ({
      status: 200,
      data: {
        data:
          url === "/office/bootstrap"
            ? {
                rooms: ["self", "peer"].map((id) => ({
                  id: `personal:${id}`,
                  kind: "personal",
                  refId: id,
                  name: id,
                  bounds: { x: 1, y: 1, w: 5, h: 5.4 },
                })),
                dmOfficeMap: { "existing-dm": "personal:peer" },
                members: [{ userId: "self", displayName: "Self" }],
              }
            : [],
      },
    }),
    PostRequest: async (url, payload) => {
      calls.push({ url, payload });
      return { status: 201, data: { data: {} } };
    },
  };
  const { LiveOfficeSource } = load(
    "app/(client)/[org]/_components/office/live-office-source.ts",
    {
      "~/utils/new-request": request,
      "~/lib/centrifugo/shared-centrifuge": {},
      "~/lib/zoe/request-contract": {},
    }
  );
  const source = new LiveOfficeSource();
  await source.init("org", "self");
  return { source, request, calls };
}
test("unmapped own office disables chat and rejects sends without an HTTP write", async () => {
  const { source, calls } = await sourceHarness();
  assert.equal(source.rooms.find((r) => r.id === "personal:self").chat, false);
  assert.equal(source.rooms.find((r) => r.id === "personal:peer").chat, true);
  await assert.rejects(
    source.sendMessage("personal:self", "Hi"),
    /no linked conversation/
  );
  assert.equal(calls.length, 0);
});
test("mapped DM and channel sends use their existing conversation and confirmed thread ID", async () => {
  const { source, calls } = await sourceHarness();
  for (const [room, endpoint] of [
    ["personal:peer", "/dms/channels/existing-dm/threads"],
    ["channel:existing-channel", "/threads/existing-channel"],
  ]) {
    const [message] = await source.sendMessage(room, "Hello");
    const call = calls.at(-1);
    assert.equal(call.url, endpoint);
    assert.equal(message.id, call.payload.thread_id);
    assert.equal(message.text, "Hello");
    assert.equal(message.self, true);
  }
});
test("failed HTTP sends reject rather than return confirmed messages", async () => {
  const { source, request } = await sourceHarness();
  request.PostRequest = async () => ({ status: 500 });
  await assert.rejects(source.sendMessage("personal:peer", "Hi"), /not sent/);
});
function sendHarness(sendMessage) {
  const file = path.join(root, "app/office/_components/OfficeDemo.tsx");
  const source = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const component = ast.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "OfficeDemo"
  );
  const fn = component.body.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "sendChat"
  );
  const code = ts.transpileModule(fn.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const messages = [],
    bubbles = [];
  const send = new Function(
    "stateRef",
    "roomById",
    "source",
    "appendMessage",
    "engineRef",
    code + ";return sendChat;"
  )(
    { current: { roomId: "personal:peer" } },
    { "personal:peer": { id: "personal:peer", chat: true } },
    { mode: "live", sendMessage },
    (m) => messages.push(m),
    { current: { showBubble: (...args) => bubbles.push(args) } }
  );
  return { send, messages, bubbles };
}
test("chat and speech bubbles appear only after server confirmation", async () => {
  const d = deferred();
  const h = sendHarness(() => d.promise);
  const pending = h.send("Hi");
  assert.deepEqual(h.messages, []);
  assert.deepEqual(h.bubbles, []);
  const confirmed = {
    id: "server-thread",
    text: "Hi",
    roomId: "personal:peer",
  };
  d.resolve([confirmed]);
  await pending;
  assert.deepEqual(h.messages, [confirmed]);
  assert.deepEqual(h.bubbles, [["you", "Hi"]]);
});
test("failed or unconfirmed sends leave no sent-looking bubble", async () => {
  for (const send of [
    () => Promise.reject(new Error("Offline")),
    async () => [],
  ]) {
    const h = sendHarness(send);
    await assert.rejects(h.send("Hi"));
    assert.deepEqual(h.messages, []);
    assert.deepEqual(h.bubbles, []);
  }
});
function panelHarness(onSend, chat = true, extra = {}) {
  const states = [],
    refs = [];
  let stateIndex, refIndex;
  const { ChatPanel } = load("app/office/_components/Panels.tsx", {
    react: {
      ...React,
      useState: (initial) => {
        const i = stateIndex++;
        if (!(i in states)) states[i] = initial;
        return [
          states[i],
          (v) => {
            states[i] = typeof v === "function" ? v(states[i]) : v;
          },
        ];
      },
      useRef: (initial) => {
        const i = refIndex++;
        return (refs[i] ??= { current: initial });
      },
      useEffect: () => {},
    },
    "~/components/ui/dialog": {},
    "~/lib/utils": { cn: (...v) => v.join(" ") },
  });
  const props = {
    open: true,
    room: { ...data.ROOMS.find((r) => r.kind === "personal"), chat },
    messages: [],
    live: true,
    onSend,
    onClose: () => {},
    ...extra,
  };
  function render() {
    stateIndex = refIndex = 0;
    const nodes = [];
    const visit = (n) => {
      if (Array.isArray(n)) return n.forEach(visit);
      if (!n || typeof n !== "object") return;
      nodes.push(n);
      visit(n.props?.children);
    };
    visit(ChatPanel(props));
    return {
      nodes,
      input: nodes.find((n) => n.type === "input"),
      form: nodes.find((n) => n.type === "form"),
    };
  }
  return { render };
}
const tick = () => new Promise(setImmediate);
test("composer retains draft during pending/failure and blocks duplicate submission", async () => {
  const d = deferred();
  let calls = 0;
  const h = panelHarness(() => {
    calls++;
    return d.promise;
  });
  h.render().input.props.onChange({ target: { value: "Retry this" } });
  const form = h.render().form;
  form.props.onSubmit({ preventDefault() {} });
  form.props.onSubmit({ preventDefault() {} });
  assert.equal(calls, 1);
  assert.equal(h.render().input.props.disabled, true);
  assert.equal(h.render().input.props.value, "Retry this");
  d.reject(new Error("Offline. Your draft is kept."));
  await tick();
  const view = h.render();
  assert.equal(view.input.props.value, "Retry this");
  assert.equal(view.input.props.disabled, false);
  assert.match(
    view.nodes.find((n) => n.props?.role === "alert").props.children,
    /Offline/
  );
});
test("confirmed send clears draft; unmapped office has no composer or synced claim", async () => {
  const h = panelHarness(async () => {});
  h.render().input.props.onChange({ target: { value: "Hi" } });
  h.render().form.props.onSubmit({ preventDefault() {} });
  await tick();
  assert.equal(h.render().input.props.value, "");
  const view = panelHarness(async () => {}, false).render();
  assert.equal(view.input, undefined);
  assert.ok(
    view.nodes.some((n) => n.props?.children === "No conversation linked")
  );
  assert.ok(
    view.nodes.some(
      (n) =>
        Array.isArray(n.props?.children) &&
        n.props.children.includes("unavailable")
    )
  );
});

test("confirmed DM message reloads from the same 2D conversation without a second ID", async () => {
  const { source, request } = await sourceHarness();
  const [sent] = await source.sendMessage("personal:peer", "Persisted");
  let endpoint;
  request.GetRequest = async (url) => {
    endpoint = url;
    return {
      status: 200,
      data: {
        data: [
          {
            thread_id: sent.id,
            user_id: "self",
            username: "Self",
            message: "Persisted",
            created_at: new Date().toISOString(),
          },
        ],
      },
    };
  };
  const messages = await source.fetchMessages("personal:peer");
  assert.equal(endpoint, "/dms/channels/existing-dm/threads?page=1&limit=50");
  assert.equal(messages[0].id, sent.id);
  assert.equal(messages[0].text, "Persisted");
});

test("unmapped office offers an explicit existing-DM choice without sending a message", () => {
  const chosen = [];
  let sends = 0;
  const peer = {
    ...data.ROOMS.find((r) => r.kind === "personal"),
    id: "personal:peer",
    name: "Office Test Two",
    chat: true,
  };
  const view = panelHarness(
    () => {
      sends++;
    },
    false,
    {
      conversations: [peer],
      onChooseConversation: (id) => chosen.push(id),
    }
  ).render();
  assert.equal(view.input, undefined);
  assert.deepEqual(chosen, []);
  const button = view.nodes.find(
    (n) => n.type === "button" && n.key === peer.id
  );
  assert.ok(button);
  button.props.onClick();
  assert.deepEqual(chosen, [peer.id]);
  assert.equal(sends, 0);
});
test("choosing a mapped DM changes only the chat target, not the physical office", () => {
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
  const fn = component.body.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "openConversation"
  );
  const code = ts.transpileModule(fn.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const chosen = [],
    opened = [];
  const choose = new Function(
    "existingConversations",
    "towerOpen",
    "setChatTargetId",
    "setTowerPreview",
    "setChatOpen",
    "setUnread",
    code + ";return openConversation;"
  )(
    [{ id: "personal:peer", chat: true }],
    false,
    (id) => chosen.push(id),
    () => {
      throw new Error("Unexpected tower move");
    },
    (v) => opened.push(v),
    () => {}
  );
  choose("personal:unmapped");
  assert.deepEqual(chosen, []);
  choose("personal:peer");
  assert.deepEqual(chosen, ["personal:peer"]);
  assert.deepEqual(opened, [true]);
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

// Run the component's actual send callback with controlled timers and a
// deferred backend response so the request's pending state is observable.
const source = fs.readFileSync(
  path.join(__dirname, "../src/app/office/_components/ZoeDialog.tsx"),
  "utf8"
);
const ast = ts.createSourceFile(
  "ZoeDialog.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const component = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "ZoeDialog"
);
const declaration = component.body.statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (item) => item.name.getText(ast) === "send"
    )
);
const code = ts.transpileModule(declaration.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

function harness() {
  const state = { thinking: false, streaming: false, messages: [], calls: 0 };
  let timeout;
  let interval;
  let resolve;
  let reject;
  const answer = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const build = new Function(
    "window",
    "thinking",
    "streaming",
    "setThinking",
    "setStreaming",
    "setMessages",
    "setDraft",
    "timeoutRef",
    "timerRef",
    "ask",
    code + ";return send;"
  );
  const window = {
    setTimeout(callback) {
      timeout = callback;
      return 1;
    },
    setInterval(callback) {
      interval = callback;
      return 2;
    },
    clearInterval() {},
  };
  const renderSend = () =>
    build(
      window,
      state.thinking,
      state.streaming,
      (value) => (state.thinking = value),
      (value) => (state.streaming = value),
      (update) => (state.messages = update(state.messages)),
      () => {},
      { current: null },
      { current: null },
      () => {
        state.calls++;
        return answer;
      }
    );
  return {
    state,
    send: (text) => renderSend()(text),
    startRequest: () => timeout(),
    stream: () => interval(),
    resolve,
    reject,
    settle: () => new Promise((done) => setImmediate(done)),
  };
}

test("pending backend request keeps thinking active and blocks another send", () => {
  const h = harness();
  h.send("First question");
  assert.equal(h.state.thinking, true);
  h.startRequest();
  assert.equal(h.state.calls, 1);
  assert.equal(h.state.thinking, true);
  h.send("Second question");
  assert.equal(h.state.messages.length, 1);
});

test("successful request moves from thinking to streaming and then permits retry", async () => {
  const h = harness();
  h.send("Question");
  h.startRequest();
  h.resolve("Yes");
  await h.settle();
  assert.equal(h.state.thinking, false);
  assert.equal(h.state.streaming, true);
  h.send("Too early");
  assert.equal(h.state.messages.length, 2);
  h.stream();
  assert.equal(h.state.messages.at(-1).content, "Yes");
  assert.equal(h.state.streaming, false);
  h.send("Next question");
  assert.equal(h.state.messages.length, 3);
  assert.equal(h.state.thinking, true);
});

test("failed request clears thinking, displays the error and permits retry", async () => {
  const h = harness();
  h.send("Question");
  h.startRequest();
  h.reject(new Error("Backend unavailable"));
  await h.settle();
  assert.equal(h.state.thinking, false);
  assert.equal(h.state.streaming, false);
  assert.equal(h.state.messages.at(-1).content, "Backend unavailable");
  h.send("Try again");
  assert.equal(h.state.thinking, true);
  assert.equal(h.state.messages.length, 3);
});

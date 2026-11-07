const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const engineSource = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "src/app/office/_components/engine/OfficeEngine.ts"
  ),
  "utf8"
);

/** The body of a class method, up to the next method at the same indent. */
function methodBody(signature) {
  const start = engineSource.indexOf(`\n  ${signature}`);
  assert.ok(start >= 0, `Found ${signature}`);
  const rest = engineSource.slice(start + 1);
  const end = rest.search(/\n  (?:private |async )?[a-zA-Z]+\(.*\)[^;]*\{\n/);
  return end > 0 ? rest.slice(0, end) : rest;
}

test("standUp clears the seat and any seat being walked to", () => {
  const body = methodBody("private standUp()");
  assert.match(body, /this\.seated = null/);
  assert.match(body, /this\.pendingSeat = null/);
});

for (const signature of [
  "teleportToRoom(",
  "focusRoom(",
  "movePlayerTo(",
  "private ensureSpawn(",
]) {
  test(`${signature.replace("private ", "")}) stands the player up before moving them`, () => {
    const body = methodBody(signature);
    const stand = body.indexOf("this.standUp()");
    const move = body.indexOf("this.playerPosition.set(");
    assert.ok(stand >= 0, "Calls standUp");
    assert.ok(move >= 0, "Moves the player");
    assert.ok(stand < move, "Stands up before the player is moved");
  });
}

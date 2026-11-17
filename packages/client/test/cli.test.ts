import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";

test("published client generator CLI prints usage", () => {
  const output = execFileSync(
    process.execPath,
    ["./cli/generate.mjs", "--help"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );

  assert.match(output, /Usage: restfx-client/);
});

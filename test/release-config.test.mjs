import assert from "node:assert/strict";
import { test } from "node:test";
import { generateNotes } from "@semantic-release/release-notes-generator";
import config, { stripTrailers } from "../release.config.mjs";

test("stripTrailers removes trailer lines and trailing blank lines", () => {
  const text =
    "allowed engines constrained\nto align with X\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://example.invalid/s\nSigned-off-by: A B <a@b.c>";
  assert.equal(stripTrailers(text), "allowed engines constrained\nto align with X");
});

test("stripTrailers keeps ordinary lines containing a colon", () => {
  assert.equal(stripTrailers("Note: heartbeat 0 now disables"), "Note: heartbeat 0 now disables");
});

test("generated notes contain the breaking change but no trailers", async () => {
  const entry = config.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "@semantic-release/release-notes-generator",
  );
  assert.ok(entry, "release-notes-generator must be configured with options");
  const message =
    "feat!: drop x\n\nBREAKING CHANGE: x is gone\n\nCo-authored-by: C <c@d.e>\nSigned-off-by: A <a@b.c>";
  const noop = () => {};
  const notes = await generateNotes(entry[1], {
    commits: [{ hash: "a".repeat(40), message }],
    lastRelease: { gitTag: "v3.0.4" },
    nextRelease: { gitTag: "v4.0.0", version: "4.0.0" },
    options: { repositoryUrl: "https://github.com/droidsolutions/amqp-ts.git" },
    cwd: process.cwd(),
    logger: { log: noop, warn: noop, error: noop, success: noop },
  });
  assert.match(notes, /x is gone/);
  assert.doesNotMatch(notes, /Co-authored-by|Signed-off-by/i);
});

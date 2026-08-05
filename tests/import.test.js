import test from "node:test";
import assert from "node:assert/strict";

test("main module imports with Foundry v13/v14-style globals", async () => {
  globalThis.Hooks = { once() {}, on() {} };
  globalThis.foundry = {
    applications: {
      api: {
        ApplicationV2: class ApplicationV2 {},
        DialogV2: class DialogV2 {}
      }
    },
    audio: { Sound: class Sound {} },
    utils: { mergeObject: (left, right) => ({ ...left, ...right }) }
  };
  globalThis.game = {};
  await import(`../scripts/main.js?smoke=${Date.now()}`);
  assert.ok(true);
});

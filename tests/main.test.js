import test from "node:test";
import assert from "node:assert/strict";

test("whole module flag deletion is recognized as an Item SFX change", async () => {
  globalThis.Hooks = { once() {}, on() {} };
  globalThis.game = {};
  const { itemConfigWasChanged } = await import(`../scripts/main.js?change-test=${Date.now()}`);

  assert.equal(itemConfigWasChanged({ flags: { "-=fl-item-sfx": null } }), true);
  assert.equal(itemConfigWasChanged({ "flags.-=fl-item-sfx": null }), true);
  assert.equal(itemConfigWasChanged({ flags: { other: {} } }), false);
});

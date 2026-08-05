import test from "node:test";
import assert from "node:assert/strict";

import { getItemSfxToolsMenuBridge } from "../scripts/ui/dialogs.js";

test("tools menu bridge resolves ApplicationV2 lazily", () => {
  class ApplicationV2 {}
  globalThis.foundry = { applications: { api: { ApplicationV2 } } };

  const Bridge = getItemSfxToolsMenuBridge();
  const instance = new Bridge();

  assert.ok(instance instanceof ApplicationV2);
});

test("tools menu bridge fails loudly without ApplicationV2", () => {
  globalThis.foundry = {};
  assert.throws(() => getItemSfxToolsMenuBridge(), /ApplicationV2 is unavailable/);
});

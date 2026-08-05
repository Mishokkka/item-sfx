import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { clearItemSfxConfig, setItemSfxConfig } from "../scripts/config.js";

let savedGame;
let savedUi;

beforeEach(() => {
  savedGame = globalThis.game;
  savedUi = globalThis.ui;
  globalThis.game = { user: { isGM: true } };
  globalThis.ui = { notifications: { info() {}, warn() {} } };
});

afterEach(() => {
  if (savedGame === undefined) delete globalThis.game;
  else globalThis.game = savedGame;
  if (savedUi === undefined) delete globalThis.ui;
  else globalThis.ui = savedUi;
});

test("saving Item SFX uses one document update", async () => {
  const updates = [];
  const item = { async update(change) { updates.push(change); } };

  const result = await setItemSfxConfig(item, { playlistId: "p", soundId: "s" }, { notify: false });

  assert.equal(result, true);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], {
    "flags.fl-item-sfx.config": { playlistId: "p", soundId: "s", source: "fl-item-sfx" },
    "flags.fl-item-sfx.-=playlistId": null,
    "flags.fl-item-sfx.-=soundId": null
  });
});

test("clearing Item SFX uses one document update", async () => {
  const updates = [];
  const item = { async update(change) { updates.push(change); } };

  const result = await clearItemSfxConfig(item, { notify: false });

  assert.equal(result, true);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], {
    "flags.fl-item-sfx.-=config": null,
    "flags.fl-item-sfx.-=playlistId": null,
    "flags.fl-item-sfx.-=soundId": null
  });
});

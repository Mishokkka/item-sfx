import test from "node:test";
import assert from "node:assert/strict";

import { playItemSfx } from "../scripts/audio.js";
import { getPlaybackPolicy } from "../scripts/settings.js";

function collection(items) {
  return {
    contents: items,
    get(id) { return items.find(entry => entry.id === id) ?? null; },
    [Symbol.iterator]() { return items[Symbol.iterator](); }
  };
}

test("one-shot audio uses Sound locally and emits one module socket event", async () => {
  const calls = { load: 0, play: 0, emit: 0 };
  class Sound {
    constructor(src, options) {
      this.src = src;
      this.options = options;
    }
    async load() { calls.load += 1; return this; }
    async play(options) { calls.play += 1; calls.playOptions = options; return this; }
  }
  const sound = { id: "sound1", name: "Shot", path: "sounds/shot.ogg", volume: 0.6 };
  const playlist = { id: "playlist1", volume: 0.8, sounds: collection([sound]) };
  globalThis.foundry = { audio: { Sound } };
  globalThis.game = {
    user: { id: "gm1" },
    audio: { environment: {} },
    playlists: { get: id => id === playlist.id ? playlist : null },
    socket: { emit: (_channel, payload) => { calls.emit += 1; calls.payload = payload; } }
  };

  const result = await playItemSfx({ playlistId: playlist.id, soundId: sound.id }, { broadcast: true });
  assert.deepEqual(result, { played: 1, failed: 0 });
  assert.equal(calls.load, 1);
  assert.equal(calls.play, 1);
  assert.equal(calls.emit, 1);
  assert.equal(calls.playOptions.volume, 0.6);
  assert.equal(calls.payload.playlistId, playlist.id);
  assert.equal(calls.payload.soundId, sound.id);
});

test("everyone playback mode never rebroadcasts", () => {
  globalThis.game = {
    user: { id: "player1" },
    users: { contents: [] },
    settings: { get: (_module, key) => key === "playMode" ? "everyone" : false }
  };
  const policy = getPlaybackPolicy({ user: "player1" });
  assert.equal(policy.allowed, true);
  assert.equal(policy.broadcast, false);
});

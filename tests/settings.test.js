import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { getPlaybackPolicy, isFirstActiveGM } from "../scripts/settings.js";

let savedGame;

beforeEach(() => {
  savedGame = globalThis.game;
});

afterEach(() => {
  if (savedGame === undefined) delete globalThis.game;
  else globalThis.game = savedGame;
});

test("author playback policy prefers ChatMessage.author", () => {
  globalThis.game = {
    user: { id: "author1" },
    settings: { get: (_module, key) => key === "playMode" ? "author" : false }
  };

  const policy = getPlaybackPolicy({
    author: { id: "author1" },
    user: { id: "stale-user" },
    _source: { author: "stale-source" }
  });

  assert.equal(policy.allowed, true);
  assert.equal(policy.authorId, "author1");
});

test("first-GM policy is false when no current user or active GM exists", () => {
  globalThis.game = {
    user: null,
    users: { contents: [] },
    settings: { get: (_module, key) => key === "playMode" ? "first-gm" : false }
  };

  const policy = getPlaybackPolicy({});
  assert.equal(policy.allowed, false);
  assert.equal(isFirstActiveGM(), false);
});

test("first active GM selection is deterministic", () => {
  globalThis.game = {
    user: { id: "gm-a" },
    users: {
      contents: [
        { id: "gm-z", active: true, isGM: true },
        { id: "player", active: true, isGM: false },
        { id: "gm-a", active: true, isGM: true }
      ]
    },
    settings: { get: (_module, key) => key === "playMode" ? "first-gm" : false }
  };

  const policy = getPlaybackPolicy({});
  assert.equal(policy.firstGMId, "gm-a");
  assert.equal(policy.allowed, true);
  assert.equal(isFirstActiveGM(), true);
});

test("first active GM ordering uses locale-independent code-point order", () => {
  globalThis.game = {
    user: { id: "Z-gm" },
    users: {
      contents: [
        { id: "a-gm", active: true, isGM: true },
        { id: "Z-gm", active: true, isGM: true }
      ]
    },
    settings: { get: (_module, key) => key === "playMode" ? "first-gm" : false }
  };

  const policy = getPlaybackPolicy({});
  assert.equal(policy.firstGMId, "Z-gm");
  assert.equal(policy.allowed, true);
  assert.equal(isFirstActiveGM(), true);
});

test("author playback policy normalizes _source.author documents", () => {
  globalThis.game = {
    user: { id: "author2" },
    settings: { get: (_module, key) => key === "playMode" ? "author" : false }
  };

  const policy = getPlaybackPolicy({ _source: { author: { id: "author2" } } });
  assert.equal(policy.allowed, true);
  assert.equal(policy.authorId, "author2");
});

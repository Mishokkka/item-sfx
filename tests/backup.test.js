import test from "node:test";
import assert from "node:assert/strict";

import { auditItemSfxReferences, rebuildActorItemBackups, syncActorItemBackup } from "../scripts/backup.js";
import { getItemSignature } from "../scripts/domain.js";

function itemCollection(items) {
  return {
    contents: items,
    get(id) { return items.find(entry => entry.id === id) ?? null; },
    [Symbol.iterator]() { return items[Symbol.iterator](); }
  };
}

function actorFixture() {
  return {
    id: "actor1",
    uuid: "Actor.actor1",
    documentName: "Actor",
    flags: {},
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = structuredClone(value);
      return value;
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

function weapon(id, actor) {
  return {
    id,
    uuid: `${actor.uuid}.Item.${id}`,
    name: "Musket",
    type: "weapon",
    img: "musket.webp",
    parent: actor,
    flags: { core: { sourceId: "Compendium.world.weapons.same-source" } },
    system: { category: "ranged", damage: 2, bonus: 1, range: "long", grip: 2 }
  };
}

test("backup sync keeps two identical copies with different embedded item ids", async () => {
  const actor = actorFixture();
  const first = weapon("firstitem1234567", actor);
  const second = weapon("seconditem123456", actor);
  actor.items = itemCollection([first, second]);

  await syncActorItemBackup(first, { playlistId: "p", soundId: "s1" });
  await syncActorItemBackup(second, { playlistId: "p", soundId: "s2" });

  const entries = actor.flags["fl-item-sfx"].actorItemBackup.items;
  assert.equal(entries.length, 2);
  assert.deepEqual(new Set(entries.map(entry => entry.itemId)), new Set([first.id, second.id]));
});

test("backup sync replaces the entry for the same item", async () => {
  const actor = actorFixture();
  const first = weapon("firstitem1234567", actor);
  actor.items = itemCollection([first]);

  await syncActorItemBackup(first, { playlistId: "p", soundId: "s1" });
  await syncActorItemBackup(first, { playlistId: "p", soundId: "s2" });

  const entries = actor.flags["fl-item-sfx"].actorItemBackup.items;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].soundId, "s2");
});

test("audit includes effective configurations restored from actor backup", async () => {
  const actor = actorFixture();
  const first = weapon("firstitem1234567", actor);
  first.flags = {};
  actor.items = itemCollection([first]);
  actor.flags["fl-item-sfx"] = {
    actorItemBackup: {
      version: 2,
      items: [{
        itemId: first.id,
        uuid: first.uuid,
        sourceIds: [first.uuid],
        signature: getItemSignature(first),
        name: first.name,
        type: first.type,
        img: first.img,
        playlistId: "missing-playlist",
        soundId: "missing-sound"
      }]
    }
  };

  const savedGame = globalThis.game;
  globalThis.game = {
    actors: itemCollection([actor]),
    scenes: itemCollection([]),
    items: itemCollection([]),
    packs: [],
    playlists: { get: () => null }
  };
  try {
    const result = await auditItemSfxReferences({ notify: false });
    assert.equal(result.configured, 1);
    assert.equal(result.missingPlaylist, 1);
  } finally {
    if (savedGame === undefined) delete globalThis.game;
    else globalThis.game = savedGame;
  }
});

test("audit reports an empty playlist for random playback", async () => {
  const actor = actorFixture();
  const first = weapon("firstitem1234567", actor);
  first.flags = {
    "fl-item-sfx": {
      config: { playlistId: "empty-playlist", soundId: "random-track" }
    }
  };
  actor.items = itemCollection([first]);
  const emptyPlaylist = { id: "empty-playlist", sounds: itemCollection([]) };

  const savedGame = globalThis.game;
  globalThis.game = {
    actors: itemCollection([actor]),
    scenes: itemCollection([]),
    items: itemCollection([]),
    packs: [],
    playlists: { get: id => id === emptyPlaylist.id ? emptyPlaylist : null }
  };
  try {
    const result = await auditItemSfxReferences({ notify: false });
    assert.equal(result.configured, 1);
    assert.equal(result.missingSound, 1);
  } finally {
    if (savedGame === undefined) delete globalThis.game;
    else globalThis.game = savedGame;
  }
});


test("backup rebuild is serialized with concurrent item backup writes", async () => {
  const actor = actorFixture();
  const first = weapon("firstitem1234567", actor);
  first.flags = {};
  actor.items = itemCollection([first]);

  let setFlagCalls = 0;
  let releaseFirst;
  let releaseSecond;
  let signalFirst;
  let signalSecond;
  const firstEntered = new Promise(resolve => { signalFirst = resolve; });
  const secondEntered = new Promise(resolve => { signalSecond = resolve; });
  const firstRelease = new Promise(resolve => { releaseFirst = resolve; });
  const secondRelease = new Promise(resolve => { releaseSecond = resolve; });

  actor.setFlag = async function setFlag(scope, key, value) {
    setFlagCalls += 1;
    if (setFlagCalls === 1) {
      signalFirst();
      await firstRelease;
    } else if (setFlagCalls === 2) {
      signalSecond();
      await secondRelease;
    }
    this.flags[scope] ??= {};
    this.flags[scope][key] = structuredClone(value);
    return value;
  };

  const savedGame = globalThis.game;
  globalThis.game = {
    user: { id: "gm", isGM: true },
    actors: itemCollection([actor]),
    scenes: itemCollection([]),
    packs: []
  };

  try {
    const sync = syncActorItemBackup(first, { playlistId: "p", soundId: "s1" });
    await firstEntered;
    const rebuild = rebuildActorItemBackups({ notify: false });

    const racedIntoSecondWrite = await Promise.race([
      secondEntered.then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 25))
    ]);
    assert.equal(racedIntoSecondWrite, false);

    releaseFirst();
    await sync;
    await secondEntered;
    releaseSecond();
    await rebuild;

    const entries = actor.flags["fl-item-sfx"].actorItemBackup.items;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].itemId, first.id);
    assert.equal(entries[0].soundId, "s1");
  } finally {
    releaseFirst?.();
    releaseSecond?.();
    if (savedGame === undefined) delete globalThis.game;
    else globalThis.game = savedGame;
  }
});

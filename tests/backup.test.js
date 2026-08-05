import test from "node:test";
import assert from "node:assert/strict";

import { syncActorItemBackup } from "../scripts/backup.js";

function itemCollection(items) {
  return {
    contents: items,
    get(id) { return items.find(entry => entry.id === id) ?? null; },
    [Symbol.iterator]() { return items[Symbol.iterator](); }
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
  const actor = {
    id: "actor1",
    uuid: "Actor.actor1",
    documentName: "Actor",
    flags: {},
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = structuredClone(value);
      return value;
    }
  };
  const first = weapon("firstitem1234567", actor);
  const second = weapon("seconditem123456", actor);
  actor.items = itemCollection([first, second]);

  await syncActorItemBackup(first, { playlistId: "p", soundId: "s1" });
  await syncActorItemBackup(second, { playlistId: "p", soundId: "s2" });

  const entries = actor.flags["fl-item-sfx"].actorItemBackup.items;
  assert.equal(entries.length, 2);
  assert.deepEqual(new Set(entries.map(entry => entry.itemId)), new Set([first.id, second.id]));
});

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  getItemSignature,
  isAttackCapableItem,
  makeBackupEntry,
  normalizeConfig,
  scoreBackupEntry,
  selectUniqueBestMatch
} from "../scripts/domain.js";
import {
  analyzeAttackMessage,
  extractRollMetadata,
  getRollTableReason,
  getSpeakerActor
} from "../scripts/chat/resolver.js";

const trackedGlobals = ["ChatMessage", "game", "fromUuid"];
let savedGlobals;

beforeEach(() => {
  savedGlobals = new Map(trackedGlobals.map(key => [
    key,
    {
      present: Object.hasOwn(globalThis, key),
      value: globalThis[key]
    }
  ]));
  for (const key of trackedGlobals) delete globalThis[key];
});

afterEach(() => {
  for (const [key, saved] of savedGlobals) {
    if (saved.present) globalThis[key] = saved.value;
    else delete globalThis[key];
  }
});

function item(overrides = {}) {
  return {
    id: "abcdefgh12345678",
    uuid: "Actor.actor123.Item.abcdefgh12345678",
    name: "Musket",
    type: "weapon",
    img: "musket.webp",
    flags: { core: { sourceId: "Compendium.world.weapons.source123" } },
    system: { category: "ranged", damage: 2, bonus: 1, range: "long", grip: 2 },
    ...overrides
  };
}

function itemCollection(items) {
  return {
    contents: items,
    get(id) { return items.find(entry => entry.id === id) ?? null; },
    [Symbol.iterator]() { return items[Symbol.iterator](); }
  };
}

function renderedRoot(textContent = "") {
  return {
    textContent,
    querySelectorAll: () => [],
    querySelector: () => null,
    matches: () => false
  };
}

function installResolverGlobals(actor, { fromUuid = undefined, scenes = undefined } = {}) {
  globalThis.ChatMessage = { getSpeakerActor: () => actor };
  if (fromUuid !== undefined) globalThis.fromUuid = fromUuid;
  globalThis.game = {
    settings: { get: () => false },
    items: { get: () => null },
    scenes,
    actors: { get: id => id === actor?.id ? actor : null }
  };
}

test("attack-capable item types are exact", () => {
  assert.equal(isAttackCapableItem(item()), true);
  assert.equal(isAttackCapableItem(item({ type: "monsterAttack" })), true);
  assert.equal(isAttackCapableItem(item({ type: "armor" })), false);
  assert.equal(isAttackCapableItem(item({ type: "weaponFeature" })), false);
});

test("config normalization rejects incomplete data", () => {
  assert.deepEqual(normalizeConfig({ playlistId: "p", soundId: "s" }), {
    playlistId: "p",
    soundId: "s",
    source: "fl-item-sfx"
  });
  assert.equal(normalizeConfig({ playlistId: "p" }), null);
});

test("backup matching prefers stable identity", () => {
  const original = item();
  const entry = makeBackupEntry(original, { playlistId: "p", soundId: "s" });
  const imported = item({ id: "newitemid123456", uuid: "Actor.newactor.Item.newitemid123456" });
  assert.equal(scoreBackupEntry(entry, imported), 100);
  assert.equal(selectUniqueBestMatch([entry], imported), entry);
});

test("ambiguous backup matches fail closed", () => {
  const target = item({ flags: {}, _stats: {}, uuid: "Actor.a.Item.target0000000000", id: "target0000000000" });
  const signature = getItemSignature(target);
  const entries = [
    { name: "Musket", type: "weapon", signature, playlistId: "p1", soundId: "s1" },
    { name: "Musket", type: "weapon", signature, playlistId: "p2", soundId: "s2" }
  ];
  assert.equal(selectUniqueBestMatch(entries, target), null);
});

test("Forbidden Lands weapon roll metadata is extracted from Roll options", () => {
  const message = {
    rolls: [{ options: { isAttack: true, itemId: "abcdefgh12345678", item: "Musket" } }]
  };
  const metadata = extractRollMetadata(message);
  assert.equal(metadata.isAttack, true);
  assert.ok(metadata.candidates.some(candidate => candidate.kind === "id" && candidate.value === "abcdefgh12345678"));
  assert.ok(metadata.candidates.some(candidate => candidate.kind === "name" && candidate.value === "Musket"));
});

test("higher-priority duplicate candidate replaces a lower-priority candidate", () => {
  const attack = item();
  const metadata = extractRollMetadata({
    rolls: [{ options: { isAttack: true, item: attack, attack } }]
  });
  const objectCandidate = metadata.candidates.find(candidate => candidate.kind === "object");
  assert.match(objectCandidate.source, /\.attack$/);
});

test("Forbidden Lands monster attack metadata is extracted", () => {
  const attack = item({ type: "monsterAttack", name: "Слушает бетон!" });
  const message = {
    rolls: [{ options: { isAttack: true, isMonsterAttack: true, attack, name: attack.name } }]
  };
  const metadata = extractRollMetadata(message);
  assert.equal(metadata.isAttack, true);
  assert.equal(metadata.isMonsterAttack, true);
  assert.ok(metadata.candidates.some(candidate => candidate.kind === "object" || candidate.kind === "document"));
});

test("ordinary skill roll does not become an attack", () => {
  const metadata = extractRollMetadata({ rolls: [{ options: { isAttack: false, name: "Move" } }] });
  assert.equal(metadata.isAttack, false);
});

test("RollTable flags are excluded", () => {
  assert.equal(getRollTableReason({ flags: { core: { RollTable: "table-id" } } }, null, null), "roll-table-flags");
});

test("resolver chooses current embedded weapon by itemId", async () => {
  const musket = item();
  const actor = { id: "actor123", uuid: "Actor.actor123", name: "Shooter", items: itemCollection([musket]) };
  installResolverGlobals(actor);

  const message = {
    id: "message1",
    speaker: { actor: actor.id },
    rolls: [{ options: { isAttack: true, itemId: musket.id, item: musket.name } }]
  };
  const result = await analyzeAttackMessage(message, null, null);
  assert.equal(result.status, "matched");
  assert.equal(result.item, musket);
});

test("resolver rejects non-attack roll even when it mentions a weapon", async () => {
  const musket = item();
  const actor = { id: "actor123", uuid: "Actor.actor123", name: "Shooter", items: itemCollection([musket]) };
  installResolverGlobals(actor);

  const result = await analyzeAttackMessage({
    id: "message2",
    speaker: { actor: actor.id },
    rolls: [{ options: { isAttack: false, itemId: musket.id, item: musket.name } }]
  }, renderedRoot(), null);

  assert.equal(result.status, "ignored");
  assert.equal(result.reason, "no-explicit-attack-signal");
});

test("resolver remaps a compendium source weapon to imported actor item", async () => {
  const imported = item({
    id: "imported12345678",
    uuid: "Actor.newactor.Item.imported12345678",
    flags: { core: { sourceId: "Compendium.world.weapons.source123" } }
  });
  const actor = { id: "newactor", uuid: "Actor.newactor", name: "Imported", items: itemCollection([imported]) };
  const source = item({
    id: "source123",
    uuid: "Compendium.world.weapons.source123",
    parent: { documentName: "Compendium" }
  });
  installResolverGlobals(actor, { fromUuid: async uuid => uuid === source.uuid ? source : null });

  const result = await analyzeAttackMessage({
    id: "message3",
    speaker: { actor: actor.id },
    rolls: [{ options: { isAttack: true, itemUuid: source.uuid, item: source.name } }]
  });

  assert.equal(result.status, "matched");
  assert.equal(result.item, imported);
});

test("object UUID identity wins over a colliding embedded item id", async () => {
  const imported = item({
    id: "imported12345678",
    uuid: "Actor.newactor.Item.imported12345678",
    flags: { core: { sourceId: "Compendium.world.weapons.source123" } }
  });
  const collision = item({
    id: "source123",
    uuid: "Actor.newactor.Item.source123",
    name: "Unrelated sword",
    flags: {}
  });
  const actor = {
    id: "newactor",
    uuid: "Actor.newactor",
    name: "Imported",
    items: itemCollection([collision, imported])
  };
  const sourceUuid = "Compendium.world.weapons.source123";
  const sourceReference = item({
    id: "source123",
    uuid: sourceUuid,
    parent: { documentName: "Compendium" }
  });
  const sourceDocument = { ...sourceReference, documentName: "Item" };
  installResolverGlobals(actor, { fromUuid: async uuid => uuid === sourceUuid ? sourceDocument : null });

  const result = await analyzeAttackMessage({
    id: "object-collision-message",
    speaker: { actor: actor.id },
    rolls: [{ options: { isAttack: true, item: sourceReference } }]
  });

  assert.equal(result.status, "matched");
  assert.equal(result.item, imported);
});

test("object resolution tries every supported UUID before ID fallback", async () => {
  const validUuid = "Compendium.world.weapons.valid123";
  const staleUuid = "Compendium.world.weapons.stale123";
  const imported = item({
    id: "imported12345678",
    uuid: "Actor.newactor.Item.imported12345678",
    flags: { core: { sourceId: validUuid } }
  });
  const collision = item({
    id: "collision1234567",
    uuid: "Actor.newactor.Item.collision1234567",
    name: "Unrelated sword",
    flags: {}
  });
  const actor = {
    id: "newactor",
    uuid: "Actor.newactor",
    name: "Imported",
    items: itemCollection([collision, imported])
  };
  const sourceDocument = item({
    id: "valid123",
    uuid: validUuid,
    documentName: "Item",
    parent: { documentName: "Compendium" }
  });
  const calls = [];
  installResolverGlobals(actor, {
    fromUuid: async uuid => {
      calls.push(uuid);
      return uuid === validUuid ? sourceDocument : null;
    }
  });

  const result = await analyzeAttackMessage({
    id: "multi-uuid-object-message",
    speaker: { actor: actor.id },
    rolls: [{
      options: {
        isAttack: true,
        item: {
          type: "weapon",
          documentUuid: staleUuid,
          weaponUuid: validUuid,
          id: collision.id,
          name: imported.name
        }
      }
    }]
  });

  assert.equal(result.status, "matched");
  assert.equal(result.item, imported);
  assert.ok(calls.includes(staleUuid));
  assert.ok(calls.includes(validUuid));
});

test("specific object IDs take precedence over generic object IDs", async () => {
  const target = item({
    id: "targetitem123456",
    uuid: "Actor.actor123.Item.targetitem123456",
    type: "monsterAttack",
    name: "Bite"
  });
  const collision = item({
    id: "collision1234567",
    uuid: "Actor.actor123.Item.collision1234567",
    type: "weapon",
    name: "Unrelated sword"
  });
  const actor = { id: "actor123", uuid: "Actor.actor123", items: itemCollection([collision, target]) };
  installResolverGlobals(actor);

  const result = await analyzeAttackMessage({
    id: "specific-id-object-message",
    speaker: { actor: actor.id },
    rolls: [{
      options: {
        isAttack: true,
        item: {
          type: "monsterAttack",
          id: collision.id,
          monsterAttackId: target.id,
          name: target.name
        }
      }
    }]
  });

  assert.equal(result.status, "matched");
  assert.equal(result.item, target);
});

test("source remapping ignores collection-local bare ID collisions", async () => {
  const sourceUuid = "Compendium.world.weapons.sharedsource";
  const imported = item({
    id: "imported12345678",
    uuid: "Actor.newactor.Item.imported12345678",
    flags: {},
    _stats: {}
  });
  const collision = item({
    id: "sharedsource",
    uuid: "Actor.newactor.Item.sharedsource",
    name: "Unrelated sword",
    flags: {},
    _stats: {}
  });
  const actor = {
    id: "newactor",
    uuid: "Actor.newactor",
    items: itemCollection([collision, imported])
  };
  const sourceDocument = item({
    id: "sharedsource",
    uuid: sourceUuid,
    documentName: "Item",
    parent: { documentName: "Compendium" },
    flags: {},
    _stats: {}
  });
  installResolverGlobals(actor, {
    fromUuid: async uuid => uuid === sourceUuid ? sourceDocument : null
  });

  const result = await analyzeAttackMessage({
    id: "bare-id-collision-message",
    speaker: { actor: actor.id },
    rolls: [{ options: { isAttack: true, itemUuid: sourceUuid } }]
  });

  assert.equal(result.status, "matched");
  assert.equal(result.item, imported);
});

test("RollTable exclusion wins even when roll options claim an attack", async () => {
  const musket = item();
  const actor = { id: "actor123", uuid: "Actor.actor123", name: "Shooter", items: itemCollection([musket]) };
  installResolverGlobals(actor);

  const result = await analyzeAttackMessage({
    id: "table-message",
    flags: { core: { RollTable: "table123" } },
    speaker: { actor: actor.id },
    rolls: [{ options: { isAttack: true, itemId: musket.id, item: musket.name } }]
  });

  assert.equal(result.status, "ignored");
  assert.equal(result.reason, "roll-table-flags");
});

test("resolver remaps a compendium monster attack to the imported actor item", async () => {
  const imported = item({
    id: "monsternew123456",
    uuid: "Actor.monsternew.Item.monsternew123456",
    type: "monsterAttack",
    name: "Слушает бетон!",
    flags: { core: { sourceId: "Compendium.world.monsters.attack123" } },
    system: { dice: 7, damage: 0, damageType: "fear", range: "short", usingStrength: false }
  });
  const actor = { id: "monsternew", uuid: "Actor.monsternew", name: "Смотритель", items: itemCollection([imported]) };
  const source = item({
    id: "attack123",
    uuid: "Compendium.world.monsters.attack123",
    type: "monsterAttack",
    name: imported.name,
    parent: { documentName: "Compendium" },
    system: imported.system
  });
  installResolverGlobals(actor, { fromUuid: async uuid => uuid === source.uuid ? source : null });

  const result = await analyzeAttackMessage({
    id: "monster-message",
    speaker: { actor: actor.id },
    rolls: [{ options: { isAttack: true, isMonsterAttack: true, attack: source, name: source.name } }]
  });

  assert.equal(result.status, "matched");
  assert.equal(result.item, imported);
});

test("monster attack text fallback is exact and unique", async () => {
  const attack = item({
    id: "monsterattack1234",
    uuid: "Actor.monster.Item.monsterattack1234",
    type: "monsterAttack",
    name: "Слушает бетон!"
  });
  const actor = { id: "monster", uuid: "Actor.monster", name: "Смотритель", items: itemCollection([attack]) };
  installResolverGlobals(actor);

  const result = await analyzeAttackMessage({
    id: "monster-text-message",
    speaker: { actor: actor.id },
    rolls: [{ options: { isAttack: true, isMonsterAttack: true } }]
  }, renderedRoot("Слушает бетон!"), null);

  assert.equal(result.status, "matched");
  assert.equal(result.item, attack);
});

test("stale unresolved UUID falls back to actor backup", async () => {
  const current = item({
    id: "currentitem12345",
    uuid: "Actor.current.Item.currentitem12345",
    flags: {},
    _stats: {}
  });
  const staleUuid = "Actor.oldactor.Item.olditem12345678";
  const actor = {
    id: "current",
    uuid: "Actor.current",
    name: "Imported",
    items: itemCollection([current]),
    flags: {
      "fl-item-sfx": {
        actorItemBackup: {
          version: 2,
          items: [{
            itemId: "olditem12345678",
            uuid: staleUuid,
            sourceIds: [staleUuid],
            signature: getItemSignature(current),
            name: current.name,
            type: current.type,
            img: current.img,
            playlistId: "p",
            soundId: "s"
          }]
        }
      }
    }
  };
  installResolverGlobals(actor, { fromUuid: async () => null });

  const result = await analyzeAttackMessage({
    id: "stale-uuid-message",
    speaker: { actor: actor.id },
    rolls: [{ options: { isAttack: true, itemUuid: staleUuid } }]
  });

  assert.equal(result.status, "matched");
  assert.equal(result.item, current);
});

test("same-priority authoritative candidates resolving to different items fail closed", async () => {
  const first = item({ id: "firstitem1234567", uuid: "Actor.actor123.Item.firstitem1234567" });
  const second = item({ id: "seconditem123456", uuid: "Actor.actor123.Item.seconditem123456" });
  const actor = { id: "actor123", uuid: "Actor.actor123", items: itemCollection([first, second]) };
  installResolverGlobals(actor);

  const result = await analyzeAttackMessage({
    id: "ambiguous-message",
    speaker: { actor: actor.id },
    rolls: [{ options: { isAttack: true, itemId: first.id, weaponId: second.id } }]
  }, renderedRoot(), null);

  assert.equal(result.status, "ignored");
  assert.equal(result.reason, "ambiguous-item-candidates");
});

test("resolved non-attack item fails closed", async () => {
  const armor = item({ type: "armor" });
  const actor = { id: "actor123", uuid: "Actor.actor123", items: itemCollection([armor]) };
  installResolverGlobals(actor);

  const result = await analyzeAttackMessage({
    id: "armor-message",
    speaker: { actor: actor.id },
    rolls: [{ options: { isAttack: true, itemId: armor.id } }]
  }, renderedRoot(), null);

  assert.equal(result.status, "ignored");
  assert.equal(result.reason, "resolved-item-is-not-attack-capable");
});

test("attack without a resolvable item waits for rendered markup", async () => {
  const actor = { id: "actor123", uuid: "Actor.actor123", items: itemCollection([]) };
  installResolverGlobals(actor);

  const result = await analyzeAttackMessage({
    id: "needs-render-message",
    speaker: { actor: actor.id },
    rolls: [{ options: { isAttack: true } }]
  }, null, null);

  assert.equal(result.status, "needs-render");
  assert.equal(result.reason, "attack-without-item-before-render");
});

test("speaker token falls back to scene lookup when fromUuid returns no actor", async () => {
  const actor = { id: "scene-actor" };
  const token = { actor };
  globalThis.ChatMessage = { getSpeakerActor: () => null };
  globalThis.fromUuid = async () => null;
  globalThis.game = {
    scenes: {
      get: id => id === "scene1" ? { tokens: { get: tokenId => tokenId === "token1" ? token : null } } : null
    },
    actors: { get: () => null }
  };

  const result = await getSpeakerActor({ speaker: { scene: "scene1", token: "token1" } });
  assert.equal(result, actor);
});

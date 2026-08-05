import test from "node:test";
import assert from "node:assert/strict";

import {
  getItemSignature,
  isAttackCapableItem,
  makeBackupEntry,
  normalizeConfig,
  scoreBackupEntry,
  selectUniqueBestMatch
} from "../scripts/domain.js";
import { extractRollMetadata, getRollTableReason } from "../scripts/chat/resolver.js";

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

import { analyzeAttackMessage } from "../scripts/chat/resolver.js";

function itemCollection(items) {
  return {
    contents: items,
    get(id) { return items.find(entry => entry.id === id) ?? null; },
    [Symbol.iterator]() { return items[Symbol.iterator](); }
  };
}

test("resolver chooses current embedded weapon by itemId", async () => {
  const musket = item();
  const actor = { id: "actor123", uuid: "Actor.actor123", name: "Shooter", items: itemCollection([musket]) };
  globalThis.ChatMessage = { getSpeakerActor: () => actor };
  globalThis.game = { settings: { get: () => false }, items: { get: () => null } };

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
  globalThis.ChatMessage = { getSpeakerActor: () => actor };
  globalThis.game = { settings: { get: () => false }, items: { get: () => null } };

  const result = await analyzeAttackMessage({
    id: "message2",
    speaker: { actor: actor.id },
    rolls: [{ options: { isAttack: false, itemId: musket.id, item: musket.name } }]
  }, { querySelectorAll: () => [], querySelector: () => null, matches: () => false, textContent: "" }, null);

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
  globalThis.ChatMessage = { getSpeakerActor: () => actor };
  globalThis.fromUuid = async uuid => uuid === source.uuid ? source : null;
  globalThis.game = { settings: { get: () => false }, items: { get: () => null } };

  const result = await analyzeAttackMessage({
    id: "message3",
    speaker: { actor: actor.id },
    rolls: [{ options: { isAttack: true, itemUuid: source.uuid, item: source.name } }]
  });

  assert.equal(result.status, "matched");
  assert.equal(result.item, imported);
});

test("RollTable exclusion wins even when roll options claim an attack", async () => {
  const musket = item();
  const actor = { id: "actor123", uuid: "Actor.actor123", name: "Shooter", items: itemCollection([musket]) };
  globalThis.ChatMessage = { getSpeakerActor: () => actor };
  globalThis.game = { settings: { get: () => false }, items: { get: () => null } };

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
  globalThis.ChatMessage = { getSpeakerActor: () => actor };
  globalThis.fromUuid = async uuid => uuid === source.uuid ? source : null;
  globalThis.game = { settings: { get: () => false }, items: { get: () => null } };

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
  globalThis.ChatMessage = { getSpeakerActor: () => actor };
  globalThis.game = { settings: { get: () => false }, items: { get: () => null } };

  const root = {
    textContent: "Слушает бетон!",
    querySelectorAll: () => [],
    querySelector: () => null,
    matches: () => false
  };
  const result = await analyzeAttackMessage({
    id: "monster-text-message",
    speaker: { actor: actor.id },
    rolls: [{ options: { isAttack: true, isMonsterAttack: true } }]
  }, root, null);

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
  globalThis.ChatMessage = { getSpeakerActor: () => actor };
  globalThis.fromUuid = async () => null;
  globalThis.game = { settings: { get: () => false }, items: { get: () => null } };

  const result = await analyzeAttackMessage({
    id: "stale-uuid-message",
    speaker: { actor: actor.id },
    rolls: [{ options: { isAttack: true, itemUuid: staleUuid } }]
  });

  assert.equal(result.status, "matched");
  assert.equal(result.item, current);
});

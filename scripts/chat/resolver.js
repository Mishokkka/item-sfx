import { ROLL_TABLE_SELECTORS } from "../constants.js";
import { isAttackCapableItem, normalizeItemType } from "../domain.js";
import { findActorItemFromBackupCandidate, remapSourceItemToActor } from "../backup.js";
import { debug } from "../settings.js";
import {
  collectionContents,
  isDocumentId,
  isDocumentUuid,
  normalizeText,
  stripHtml,
  uniqueStrings
} from "../utils.js";

const ID_KEYS = new Set([
  "itemId", "itemID", "weaponId", "weaponID", "attackId", "attackID",
  "monsterAttackId", "monsterAttackID", "monsterattackId", "monsterattackID"
]);
const UUID_KEYS = new Set([
  "itemUuid", "itemUUID", "weaponUuid", "weaponUUID", "attackUuid", "attackUUID",
  "monsterAttackUuid", "monsterAttackUUID", "monsterattackUuid", "monsterattackUUID"
]);
const NAME_KEYS = new Set([
  "itemName", "weaponName", "attackName", "monsterAttackName", "monsterattackName"
]);
const OBJECT_KEYS = new Set([
  "item", "weapon", "attack", "monsterAttack", "monsterattack", "gear",
  "sourceItem", "usedItem", "rolledItem", "attackItem", "monsterAttackItem"
]);

/** Return all rolls attached to a ChatMessage across Foundry data shapes. */
function getRolls(message) {
  const rolls = message?.rolls ?? message?._source?.rolls;
  return collectionContents(rolls);
}

/** Return the number of rolls attached to a ChatMessage. */
export function getRollCount(message) {
  return getRolls(message).length;
}

/** Interpret strict boolean-like values used by roll metadata. */
function directBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

/** Build a stable deduplication key for a resolver candidate. */
function candidateKey(candidate) {
  if (candidate.kind === "document" || candidate.kind === "object") {
    const value = candidate.value ?? {};
    const identity = value.uuid ?? value.id ?? value._id ?? value.itemId ?? value.attackId
      ?? `${value.type ?? candidate.type ?? ""}:${value.name ?? candidate.name ?? "unknown"}`;
    return `${candidate.kind}:${identity}`;
  }
  return `${candidate.kind}:${String(candidate.value ?? "")}`;
}

/** Insert or replace a resolver candidate by authority and priority. */
function pushCandidate(output, candidate) {
  if (!candidate?.value) return;
  const key = candidateKey(candidate);
  const existingIndex = output._candidateIndexes.get(key);
  if (existingIndex === undefined) {
    output._candidateIndexes.set(key, output.candidates.length);
    output.candidates.push(candidate);
    return;
  }

  const existing = output.candidates[existingIndex];
  const isBetter = Number(!!candidate.authority) > Number(!!existing.authority)
    || (!!candidate.authority === !!existing.authority && candidate.priority > existing.priority);
  if (isBetter) output.candidates[existingIndex] = candidate;
}

/** Extract typed document, UUID, id, and name candidates from a metadata value. */
function addValueCandidate(output, value, { hint = "", source = "unknown", priority = 0, authority = false, type = "" } = {}) {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const entry of value) addValueCandidate(output, entry, { hint, source, priority, authority, type });
    return;
  }

  if (typeof value === "object") {
    const documentName = value.documentName ?? value.constructor?.metadata?.name;
    if (documentName === "Item" || value?.type && (value?.id || value?._id || value?.uuid)) {
      pushCandidate(output, {
        kind: documentName === "Item" ? "document" : "object",
        value,
        source,
        priority: priority + 20,
        authority,
        type: String(value.type ?? type ?? ""),
        name: String(value.name ?? "")
      });
    }

    const uuidKeys = ["uuid", "documentUuid", "itemUuid", "weaponUuid", "attackUuid", "monsterAttackUuid"];
    const hasDocumentUuid = uuidKeys.some(key => isDocumentUuid(String(value[key] ?? "")));
    for (const key of uuidKeys) {
      if (value[key] != null) addValueCandidate(output, value[key], { hint: "uuid", source, priority: priority + 10, authority, type: value.type ?? type });
    }
    if (!hasDocumentUuid) {
      for (const key of ["id", "_id", "itemId", "weaponId", "attackId", "monsterAttackId"]) {
        if (value[key] != null) addValueCandidate(output, value[key], { hint: "id", source, priority: priority + 5, authority, type: value.type ?? type });
      }
    }
    if (value.name != null) addValueCandidate(output, value.name, { hint: "name", source, priority, authority, type: value.type ?? type });
    return;
  }

  const text = String(value).trim();
  if (!text) return;
  const lowerHint = String(hint).toLowerCase();

  if (lowerHint.includes("uuid") || isDocumentUuid(text)) {
    if (isDocumentUuid(text)) pushCandidate(output, { kind: "uuid", value: text, source, priority: priority + 10, authority, type });
    return;
  }
  if (lowerHint.includes("id")) {
    if (isDocumentId(text)) pushCandidate(output, { kind: "id", value: text, source, priority: priority + 5, authority, type });
    return;
  }

  const name = stripHtml(text).replace(/\s+/g, " ").trim();
  if (name.length >= 2 && name.length <= 160) {
    pushCandidate(output, { kind: "name", value: name, source, priority, authority, type });
  }
}

/** Inspect one known roll-options object for attack metadata. */
function inspectOptionsRoot(root, output, source, priority) {
  if (!root || typeof root !== "object") return;

  const rootIsMonsterAttack = directBoolean(root.isMonsterAttack);
  const rootIsAttack = directBoolean(root.isAttack) || rootIsMonsterAttack;
  if (rootIsAttack) output.isAttack = true;
  if (rootIsMonsterAttack) output.isMonsterAttack = true;

  for (const [key, value] of Object.entries(root)) {
    if (ID_KEYS.has(key)) addValueCandidate(output, value, { hint: "id", source: `${source}.${key}`, priority: priority + 20, authority: true });
    else if (UUID_KEYS.has(key)) addValueCandidate(output, value, { hint: "uuid", source: `${source}.${key}`, priority: priority + 30, authority: true });
    else if (NAME_KEYS.has(key)) addValueCandidate(output, value, { hint: "name", source: `${source}.${key}`, priority: priority, authority: true });
    else if (OBJECT_KEYS.has(key)) addValueCandidate(output, value, {
      hint: key,
      source: `${source}.${key}`,
      priority: priority + (key === "attack" || key.toLowerCase().includes("monsterattack") ? 30 : 10),
      authority: true,
      type: key.toLowerCase().includes("monsterattack") ? "monsterAttack" : ""
    });
  }

  if (rootIsAttack && root.name != null) {
    addValueCandidate(output, root.name, {
      hint: "name",
      source: `${source}.name`,
      priority: priority - 5,
      authority: true,
      type: rootIsMonsterAttack ? "monsterAttack" : ""
    });
  }
}

/** Collect supported roll-options representations without mutating a roll. */
function rollOptionRoots(roll) {
  const roots = [
    roll?.options,
    roll?._source?.options,
    roll?._options,
    roll?.data?.options,
    roll?._data?.options
  ];
  try {
    roots.push(roll?.toJSON?.()?.options);
  } catch (_error) {
    // Some Roll implementations cannot be serialized before evaluation.
  }
  return roots.filter(root => root && typeof root === "object");
}

/** Inspect namespaced flag objects without recursively trusting arbitrary data. */
function inspectStrictFlagObject(flags, output, source = "flags") {
  if (!flags || typeof flags !== "object") return;
  for (const [namespace, value] of Object.entries(flags)) {
    if (!value || typeof value !== "object") continue;
    inspectOptionsRoot(value, output, `${source}.${namespace}`, 80);
    for (const nestedKey of ["options", "roll", "context", "data"]) {
      if (value[nestedKey] && typeof value[nestedKey] === "object") {
        inspectOptionsRoot(value[nestedKey], output, `${source}.${namespace}.${nestedKey}`, 75);
      }
    }
  }
}

/** Extract authoritative attack candidates from rendered chat markup. */
function collectDomCandidates(root, output) {
  if (!root?.querySelectorAll) return;

  const attributes = {
    uuid: [
      "data-item-uuid", "data-weapon-uuid", "data-attack-uuid",
      "data-monster-attack-uuid", "data-monsterattack-uuid", "data-document-uuid"
    ],
    id: [
      "data-item-id", "data-itemid", "data-weapon-id", "data-weaponid",
      "data-attack-id", "data-attackid", "data-monster-attack-id", "data-monsterattack-id"
    ],
    name: [
      "data-item-name", "data-weapon-name", "data-attack-name",
      "data-monster-attack-name", "data-monsterattack-name"
    ]
  };

  for (const [kind, attrs] of Object.entries(attributes)) {
    for (const attr of attrs) {
      const elements = [];
      if (root.matches?.(`[${attr}]`)) elements.push(root);
      elements.push(...root.querySelectorAll(`[${attr}]`));
      for (const element of elements) {
        if (attr.includes("attack")) {
          output.isAttack = true;
          if (attr.includes("monster")) output.isMonsterAttack = true;
        }
        addValueCandidate(output, element.getAttribute(attr), {
          hint: kind,
          source: `dom.${attr}`,
          priority: kind === "uuid" ? 105 : kind === "id" ? 95 : 55,
          authority: true,
          type: attr.includes("monster") ? "monsterAttack" : ""
        });
      }
    }
  }

  const nameSelectors = [
    ".chat-card .item-name", ".fbl-card .item-name", ".weapon-name",
    ".attack-name", ".monster-attack-name", ".monsterAttack-name"
  ];
  for (const selector of nameSelectors) {
    for (const element of root.querySelectorAll(selector)) {
      addValueCandidate(output, element.textContent, {
        hint: "name",
        source: `dom.${selector}`,
        priority: 50,
        authority: true,
        type: selector.includes("monster") ? "monsterAttack" : ""
      });
    }
  }
}

/** Collect and prioritize explicit attack metadata from message, context, and DOM. */
export function extractRollMetadata(message, root = null, context = null) {
  const output = {
    isAttack: false,
    isMonsterAttack: false,
    candidates: [],
    _candidateIndexes: new Map()
  };

  for (const [index, roll] of getRolls(message).entries()) {
    for (const [rootIndex, options] of rollOptionRoots(roll).entries()) {
      inspectOptionsRoot(options, output, `rolls.${index}.options.${rootIndex}`, 120);
    }
  }

  inspectStrictFlagObject(message?.flags, output, "message.flags");
  inspectStrictFlagObject(message?._source?.flags, output, "message.source.flags");
  inspectStrictFlagObject(context?.flags, output, "context.flags");
  inspectOptionsRoot(context?.roll, output, "context.roll", 70);
  inspectOptionsRoot(context?.options, output, "context.options", 70);
  collectDomCandidates(root, output);

  output.candidates.sort((a, b) => b.priority - a.priority);
  delete output._candidateIndexes;
  return output;
}

/** Return the fail-closed reason when a message is a RollTable result. */
export function getRollTableReason(message, root, context) {
  const flagSets = [message?.flags, message?._source?.flags, context?.flags, context?.message?.flags];
  for (const flags of flagSets) {
    if (!flags || typeof flags !== "object") continue;
    const core = flags.core ?? flags.Core;
    if (core?.RollTable || core?.rollTable || core?.rollTableId || core?.tableId) return "roll-table-flags";
    if (flags.RollTable || flags.rollTable || flags.rollTableId || flags.tableId) return "roll-table-flags";
  }

  if (root) {
    for (const selector of ROLL_TABLE_SELECTORS) {
      if (root.matches?.(selector) || root.querySelector?.(selector)) return "roll-table-dom";
    }
  }

  const content = String(message?.content ?? message?._source?.content ?? "");
  if (/class=["'][^"']*(table-draw|table-results|table-result|roll-table)[^"']*["']/i.test(content)) return "roll-table-content";
  return null;
}

/** Resolve the ChatMessage speaker actor with UUID and scene-token fallbacks. */
export async function getSpeakerActor(message) {
  const speaker = message?.speaker ?? message?._source?.speaker ?? {};
  try {
    const actor = globalThis.ChatMessage?.getSpeakerActor?.(speaker);
    if (actor) return actor;
  } catch (_error) {
    // Manual resolution below.
  }

  if (speaker.scene && speaker.token) {
    let token = null;
    try {
      token = await globalThis.fromUuid?.(`Scene.${speaker.scene}.Token.${speaker.token}`);
    } catch (_error) {
      // Fall through to the direct scene/token lookup.
    }
    if (token?.actor) return token.actor;

    const scene = globalThis.game?.scenes?.get?.(speaker.scene);
    token = scene?.tokens?.get?.(speaker.token);
    if (token?.actor) return token.actor;
  }

  return speaker.actor ? globalThis.game?.actors?.get?.(speaker.actor) ?? null : null;
}

/** Return an actor item collection as an array. */
function actorItems(actor) {
  return collectionContents(actor?.items);
}

/** Return the sole unique document in a candidate collection. */
function exactUnique(items) {
  const unique = [...new Map((items ?? []).map(item => [item?.uuid ?? item?.id, item])).values()].filter(Boolean);
  return unique.length === 1 ? unique[0] : null;
}

/** Resolve a uniquely named actor item with an optional exact type hint. */
function resolveActorItemByName(actor, name, typeHint = "") {
  const normalizedName = normalizeText(name);
  if (!normalizedName) return null;
  const normalizedType = normalizeItemType(typeHint);
  const matches = actorItems(actor).filter(item => {
    if (normalizeText(item.name) !== normalizedName) return false;
    return !normalizedType || normalizeItemType(item.type) === normalizedType;
  });
  return exactUnique(matches);
}

/** Resolve an actor item by current, source, or backup identity. */
function resolveActorItemById(actor, id) {
  if (!actor?.items || !id) return null;
  const direct = actor.items.get?.(id);
  if (direct) return direct;

  const matches = actorItems(actor).filter(item => {
    const ids = new Set([
      item.id,
      item.uuid,
      item?._stats?.compendiumSource,
      item?._source?._stats?.compendiumSource,
      item?.flags?.core?.sourceId,
      item?._source?.flags?.core?.sourceId
    ].filter(Boolean).map(String));
    return ids.has(String(id));
  });
  return exactUnique(matches) ?? findActorItemFromBackupCandidate(actor, id);
}

/** Resolve one metadata candidate to an Item document. */
async function resolveCandidate(candidate, actor) {
  if (!candidate) return null;

  if (candidate.kind === "document") {
    const document = candidate.value;
    if (document?.documentName !== "Item") return null;
    return actor ? remapSourceItemToActor(document, actor) : document;
  }

  if (candidate.kind === "object") {
    const value = candidate.value;
    const uuid = value.uuid ?? value.itemUuid ?? value.attackUuid;
    if (uuid) {
      const byUuid = await resolveCandidate({ ...candidate, kind: "uuid", value: uuid }, actor);
      if (byUuid) return byUuid;
    }
    if (actor) {
      const byId = resolveActorItemById(actor, value.id ?? value._id ?? value.itemId ?? value.attackId);
      if (byId) return byId;
      const byName = resolveActorItemByName(actor, value.name, value.type ?? candidate.type);
      if (byName) return byName;
    }
    return null;
  }

  if (candidate.kind === "uuid") {
    try {
      const document = await globalThis.fromUuid?.(candidate.value);
      if (document?.documentName === "Item") {
        return actor ? remapSourceItemToActor(document, actor) : document;
      }
      return actor ? findActorItemFromBackupCandidate(actor, candidate.value) : null;
    } catch (_error) {
      return actor ? findActorItemFromBackupCandidate(actor, candidate.value) : null;
    }
  }

  if (candidate.kind === "id") {
    if (actor) {
      const actorItem = resolveActorItemById(actor, candidate.value);
      if (actorItem) return actorItem;
    }
    const worldItem = globalThis.game?.items?.get?.(candidate.value);
    if (!worldItem) return null;
    return actor ? remapSourceItemToActor(worldItem, actor) : worldItem;
  }

  if (candidate.kind === "name") {
    return actor ? resolveActorItemByName(actor, candidate.value, candidate.type) : null;
  }

  return null;
}

/** Resolve only the highest viable priority group and fail on ambiguity. */
async function resolveHighestPriorityCandidates(candidates, actor) {
  const priorities = [...new Set((candidates ?? []).map(candidate => candidate.priority))].sort((a, b) => b - a);
  for (const priority of priorities) {
    const group = candidates.filter(candidate => candidate.priority === priority);
    const resolved = [];
    for (const candidate of group) {
      const item = await resolveCandidate(candidate, actor);
      if (item) resolved.push({ item, candidate });
    }

    const uniqueItems = [...new Map(resolved.map(result => [result.item.uuid ?? result.item.id, result])).values()];
    if (uniqueItems.length === 1) return { ...uniqueItems[0], ambiguous: false };
    if (uniqueItems.length > 1) return { item: null, candidate: null, ambiguous: true, priority, resolved: uniqueItems };
  }
  return { item: null, candidate: null, ambiguous: false };
}

/** Find a unique monster attack by exact rendered-text boundary matching. */
function findExactMonsterAttackInMessage(actor, message, root) {
  const text = normalizeText([
    root?.textContent ?? "",
    stripHtml(message?.flavor ?? ""),
    stripHtml(message?.content ?? message?._source?.content ?? "")
  ].join(" "));
  if (!text) return null;

  const matches = actorItems(actor).filter(item => {
    if (normalizeItemType(item.type) !== "monsterattack") return false;
    const name = normalizeText(item.name);
    if (!name || name.length < 2) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`, "u").test(text);
  });
  return exactUnique(matches);
}

/** Classify an attack message and resolve its unique supported Item. */
export async function analyzeAttackMessage(message, root = null, context = null) {
  const rollCount = getRollCount(message);
  if (!rollCount) return { status: "ignored", reason: "no-roll", rollCount };

  const rollTableReason = getRollTableReason(message, root, context);
  if (rollTableReason) return { status: "ignored", reason: rollTableReason, rollCount };

  const actor = await getSpeakerActor(message);
  const metadata = extractRollMetadata(message, root, context);
  const authoritativeCandidates = metadata.candidates.filter(candidate => candidate.authority);
  if (!metadata.isAttack) {
    return {
      status: root ? "ignored" : "needs-render",
      reason: root ? "no-explicit-attack-signal" : "roll-awaiting-rendered-attack-markup",
      actor,
      metadata,
      rollCount
    };
  }

  const resolved = await resolveHighestPriorityCandidates(authoritativeCandidates, actor);
  if (resolved.ambiguous) {
    return { status: "ignored", reason: "ambiguous-item-candidates", actor, metadata, rollCount };
  }

  let item = resolved.item;
  if (!item && metadata.isMonsterAttack && actor) item = findExactMonsterAttackInMessage(actor, message, root);

  if (!item) {
    return {
      status: !root && metadata.isAttack ? "needs-render" : "no-match",
      reason: !root && metadata.isAttack ? "attack-without-item-before-render" : "attack-item-not-resolved",
      actor,
      metadata,
      rollCount
    };
  }

  if (!isAttackCapableItem(item)) {
    return {
      status: "ignored",
      reason: "resolved-item-is-not-attack-capable",
      actor,
      item,
      metadata,
      rollCount
    };
  }

  debug("resolved attack item", {
    messageId: message?.id,
    item: { id: item.id, uuid: item.uuid, name: item.name, type: item.type },
    source: resolved.candidate?.source ?? (metadata.isMonsterAttack ? "monster-text-fallback" : "unknown")
  });

  return { status: "matched", reason: "attack-item-resolved", actor, item, metadata, rollCount };
}

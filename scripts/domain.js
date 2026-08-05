import { ATTACK_ITEM_TYPES, BACKUP_VERSION, MODULE_ID } from "./constants.js";
import { normalizeText, rawFlag, uniqueStrings } from "./utils.js";

export function normalizeItemType(type) {
  return normalizeText(type).replace(/[\s_-]+/g, "");
}

export function isAttackCapableItem(item) {
  return ATTACK_ITEM_TYPES.has(normalizeItemType(item?.type));
}

export function normalizeConfig(config) {
  if (!config || typeof config !== "object") return null;
  const playlistId = String(config.playlistId ?? "").trim();
  const soundId = String(config.soundId ?? "").trim();
  if (!playlistId || !soundId) return null;
  return {
    playlistId,
    soundId,
    source: String(config.source ?? MODULE_ID)
  };
}

export function isUsableConfig(config) {
  return normalizeConfig(config) !== null;
}

export function collectSourceIds(item) {
  const values = [
    item?.uuid,
    item?.id,
    rawFlag(item, "core", "sourceId"),
    item?._source?.flags?.core?.sourceId,
    item?._stats?.compendiumSource,
    item?._source?._stats?.compendiumSource,
    item?._stats?.duplicateSource
  ];
  return new Set(uniqueStrings(values));
}

export function getItemSignature(item) {
  const system = item?.system ?? item?._source?.system ?? {};
  return [
    normalizeText(item?.name),
    normalizeItemType(item?.type),
    String(item?.img ?? ""),
    String(system.category ?? ""),
    String(system.type ?? ""),
    String(system.damage ?? ""),
    String(system.bonus ?? ""),
    String(system.range ?? ""),
    String(system.grip ?? ""),
    String(system.damageType ?? ""),
    String(system.dice ?? ""),
    String(system.usingStrength ?? "")
  ].join("|");
}

export function makeBackupEntry(item, config) {
  const normalized = normalizeConfig(config);
  if (!normalized) return null;
  return {
    itemId: String(item?.id ?? ""),
    uuid: String(item?.uuid ?? ""),
    sourceIds: [...collectSourceIds(item)],
    signature: getItemSignature(item),
    name: String(item?.name ?? ""),
    type: String(item?.type ?? ""),
    img: String(item?.img ?? ""),
    playlistId: normalized.playlistId,
    soundId: normalized.soundId,
    source: normalized.source,
    updatedAt: new Date().toISOString()
  };
}

export function normalizeBackupStore(store) {
  let items = [];
  if (Array.isArray(store)) items = store;
  else if (Array.isArray(store?.items)) items = store.items;
  else if (store && typeof store === "object") items = Object.values(store).filter(value => value && typeof value === "object");

  return {
    version: Number(store?.version ?? 1),
    items: items
      .filter(Boolean)
      .map(entry => ({
        ...entry,
        itemId: String(entry.itemId ?? ""),
        uuid: String(entry.uuid ?? ""),
        sourceIds: uniqueStrings([entry.sourceId, entry.uuid, ...(Array.isArray(entry.sourceIds) ? entry.sourceIds : [])]),
        signature: String(entry.signature ?? ""),
        name: String(entry.name ?? ""),
        type: String(entry.type ?? ""),
        img: String(entry.img ?? ""),
        playlistId: String(entry.playlistId ?? entry.config?.playlistId ?? ""),
        soundId: String(entry.soundId ?? entry.config?.soundId ?? ""),
        source: String(entry.source ?? entry.config?.source ?? `${MODULE_ID}-actor-backup`)
      }))
      .filter(entry => entry.playlistId && entry.soundId)
  };
}

export function scoreBackupEntry(entry, item) {
  if (!entry || !item) return 0;
  if (entry.itemId && item.id && entry.itemId === item.id) return 120;
  if (entry.uuid && item.uuid && entry.uuid === item.uuid) return 120;

  const itemSources = collectSourceIds(item);
  const entrySources = new Set(uniqueStrings([entry.uuid, entry.sourceId, ...(entry.sourceIds ?? [])]));
  for (const source of entrySources) {
    if (itemSources.has(source)) return 100;
  }

  if (entry.signature && entry.signature === getItemSignature(item)) return 90;

  const sameNameType = normalizeText(entry.name) === normalizeText(item.name)
    && normalizeItemType(entry.type) === normalizeItemType(item.type);
  if (sameNameType && entry.img && item.img && entry.img === item.img) return 60;
  if (sameNameType) return 30;
  return 0;
}

export function selectUniqueBestMatch(entries, item, { minimumScore = 1 } = {}) {
  const scored = (entries ?? [])
    .map(entry => ({ entry, score: scoreBackupEntry(entry, item) }))
    .filter(result => result.score >= minimumScore)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].entry;
}

export function backupStorePayload(entries) {
  return { version: BACKUP_VERSION, items: (entries ?? []).filter(Boolean) };
}

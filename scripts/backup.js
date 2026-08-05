import {
  BACKUP_MINIMUM_MATCH_SCORE,
  FLAGS,
  MODULE_ID,
  PLAYBACK
} from "./constants.js";
import {
  backupStorePayload,
  collectSourceIds,
  getItemSignature,
  isUsableConfig,
  makeBackupEntry,
  normalizeBackupStore,
  normalizeConfig,
  normalizeItemType,
  scoreBackupEntry,
  selectUniqueBestMatch
} from "./domain.js";
import { debug } from "./settings.js";
import {
  collectionContents,
  localizeFormat,
  normalizeText,
  rawFlag,
  safeGetFlag
} from "./utils.js";

/** Read current or legacy configuration stored directly on an item. */
function getStoredItemConfig(item) {
  const current = normalizeConfig(safeGetFlag(item, MODULE_ID, FLAGS.config));
  if (current) return current;
  return normalizeConfig({
    playlistId: safeGetFlag(item, MODULE_ID, "playlistId"),
    soundId: safeGetFlag(item, MODULE_ID, "soundId"),
    source: MODULE_ID
  });
}

const actorBackupQueues = new Map();

/** Serialize actor-backup read-modify-write operations per actor. */
async function withActorBackupQueue(actor, operation) {
  const key = String(actor?.uuid ?? actor?.id ?? "");
  if (!key) return operation();
  const previous = actorBackupQueues.get(key) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(operation);
  actorBackupQueues.set(key, task);
  try {
    return await task;
  } finally {
    if (actorBackupQueues.get(key) === task) actorBackupQueues.delete(key);
  }
}

/** Return the parent actor for an embedded item. */
export function getParentActor(item) {
  return item?.parent?.documentName === "Actor" ? item.parent : null;
}

/** Read and normalize an actor Item SFX backup store. */
export function getActorBackupStore(actor) {
  const raw = safeGetFlag(actor, MODULE_ID, FLAGS.actorBackup)
    ?? rawFlag(actor, MODULE_ID, FLAGS.actorBackup);
  return normalizeBackupStore(raw);
}

/** Resolve an embedded item configuration from its parent actor backup. */
export function getActorItemBackupConfig(item) {
  const actor = getParentActor(item);
  if (!actor) return null;

  const store = getActorBackupStore(actor);
  const match = selectUniqueBestMatch(store.items, item, {
    minimumScore: BACKUP_MINIMUM_MATCH_SCORE
  });
  if (!match) return null;
  return normalizeConfig({
    playlistId: match.playlistId,
    soundId: match.soundId,
    source: match.source ?? `${MODULE_ID}-actor-backup`
  });
}

/** Check exact embedded item id or UUID identity. */
function exactEntryIdentityMatch(entry, item) {
  if (!entry || !item) return false;
  return !!(
    entry.itemId && item.id && String(entry.itemId) === String(item.id)
    || entry.uuid && item.uuid && String(entry.uuid) === String(item.uuid)
  );
}

/** Check whether an item and backup entry share a stable source identity. */
function sourceIdentityOverlaps(entry, item) {
  const itemSources = collectSourceIds(item);
  const entrySources = new Set([entry?.uuid, ...(entry?.sourceIds ?? [])].filter(Boolean).map(String));
  return [...entrySources].some(source => itemSources.has(source));
}

/** Find backup entries that can be safely replaced for one actor item. */
function replacementEntryIndexes(store, actor, item) {
  const entries = store?.items ?? [];
  const direct = entries
    .map((entry, index) => exactEntryIdentityMatch(entry, item) ? index : -1)
    .filter(index => index >= 0);
  if (direct.length) return new Set(direct);

  const actorItems = collectionContents(actor?.items);
  const itemSources = collectSourceIds(item);
  const sourceEntries = entries
    .map((entry, index) => sourceIdentityOverlaps(entry, item) ? index : -1)
    .filter(index => index >= 0);
  const sourceActorMatches = actorItems.filter(candidate =>
    [...collectSourceIds(candidate)].some(source => itemSources.has(source)));
  if (sourceEntries.length === 1 && sourceActorMatches.length === 1) return new Set(sourceEntries);

  const signature = getItemSignature(item);
  const signatureEntries = entries
    .map((entry, index) => entry.signature && entry.signature === signature ? index : -1)
    .filter(index => index >= 0);
  const signatureActorMatches = actorItems.filter(candidate => getItemSignature(candidate) === signature);
  if (signatureEntries.length === 1 && signatureActorMatches.length === 1) return new Set(signatureEntries);
  return new Set();
}

/** Insert or replace one configured embedded item in its actor backup. */
export async function syncActorItemBackup(item, config) {
  const actor = getParentActor(item);
  const entry = makeBackupEntry(item, config);
  if (!actor || !entry) return false;

  return withActorBackupQueue(actor, async () => {
    try {
      const store = getActorBackupStore(actor);
      const replace = replacementEntryIndexes(store, actor, item);
      const items = store.items.filter((_existing, index) => !replace.has(index));
      items.push(entry);
      await actor.setFlag(MODULE_ID, FLAGS.actorBackup, backupStorePayload(items));
      return true;
    } catch (error) {
      console.warn(`${MODULE_ID} | failed to synchronize actor item backup`, { actor, item, error });
      return false;
    }
  });
}

/** Remove the uniquely identified backup entry for an embedded item. */
export async function removeActorItemBackup(item) {
  const actor = getParentActor(item);
  if (!actor) return false;

  return withActorBackupQueue(actor, async () => {
    try {
      const store = getActorBackupStore(actor);
      const remove = replacementEntryIndexes(store, actor, item);
      const items = store.items.filter((_existing, index) => !remove.has(index));
      await actor.setFlag(MODULE_ID, FLAGS.actorBackup, backupStorePayload(items));
      return true;
    } catch (error) {
      console.warn(`${MODULE_ID} | failed to remove actor item backup`, { actor, item, error });
      return false;
    }
  });
}

/** Resolve an actor item from an id or UUID recorded in actor backup. */
export function findActorItemFromBackupCandidate(actor, value) {
  if (!actor?.items || value == null) return null;
  const candidate = String(value).trim();
  if (!candidate) return null;

  const matchingEntries = getActorBackupStore(actor).items.filter(entry => {
    const values = [entry.itemId, entry.uuid, ...(entry.sourceIds ?? [])]
      .map(entryValue => String(entryValue ?? "").trim())
      .filter(Boolean);
    return values.includes(candidate);
  });

  return findActorItemForBackupEntries(actor, matchingEntries);
}

/** Resolve a unique best actor item across candidate backup entries. */
export function findActorItemForBackupEntries(actor, entries) {
  const items = collectionContents(actor?.items);
  if (!items.length || !entries?.length) return null;

  const scored = [];
  for (const entry of entries) {
    for (const item of items) {
      const score = scoreBackupEntry(entry, item);
      if (score > 0) scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) return null;

  const bestScore = scored[0].score;
  const bestItems = [...new Map(
    scored.filter(result => result.score === bestScore).map(result => [result.item.id, result.item])
  ).values()];
  return bestItems.length === 1 ? bestItems[0] : null;
}

/** Restore missing embedded item flags from one actor backup. */
export async function restoreActorItemBackups(actor) {
  if (!actor?.items || !globalThis.game?.user?.isGM) return { restored: 0, ambiguous: 0 };
  const store = getActorBackupStore(actor);
  if (!store.items.length) return { restored: 0, ambiguous: 0 };

  const updates = [];
  let ambiguous = 0;

  for (const item of collectionContents(actor.items)) {
    const ownRaw = rawFlag(item, MODULE_ID, FLAGS.config);
    const hasLegacyOwn = !!getStoredItemConfig(item);
    if (ownRaw !== undefined || hasLegacyOwn) continue;

    const matching = store.items
      .map(entry => ({ entry, score: scoreBackupEntry(entry, item) }))
      .filter(result => result.score >= BACKUP_MINIMUM_MATCH_SCORE)
      .sort((a, b) => b.score - a.score);
    if (!matching.length) continue;
    if (matching.length > 1 && matching[0].score === matching[1].score) {
      ambiguous += 1;
      continue;
    }

    const config = normalizeConfig(matching[0].entry);
    if (!config) continue;
    updates.push({ _id: item.id, [`flags.${MODULE_ID}.${FLAGS.config}`]: config });
  }

  if (!updates.length) return { restored: 0, ambiguous };

  try {
    await actor.updateEmbeddedDocuments("Item", updates);
    debug("restored item configs from actor backup", {
      actor: { id: actor.id, uuid: actor.uuid, name: actor.name },
      restored: updates.length,
      ambiguous
    });
    return { restored: updates.length, ambiguous };
  } catch (error) {
    console.warn(`${MODULE_ID} | failed to restore actor item backups`, { actor, error });
    return { restored: 0, ambiguous, failed: updates.length };
  }
}

/** Build a stable key for actor collection deduplication. */
function actorDeduplicationKey(actor) {
  return String(actor?.uuid ?? actor?.id ?? "");
}

/** Collect writable world actors and optional actor-compendium documents. */
async function collectActors({ includeCompendiums = false } = {}) {
  const actors = new Map();
  const add = (actor, metadata = {}) => {
    if (!actor?.items) return;
    const key = actorDeduplicationKey(actor);
    if (!key || actors.has(key)) return;
    actors.set(key, { actor, ...metadata });
  };

  for (const actor of collectionContents(globalThis.game?.actors)) add(actor);
  for (const scene of collectionContents(globalThis.game?.scenes)) {
    for (const token of collectionContents(scene?.tokens)) add(token?.actor, { synthetic: true });
  }

  if (includeCompendiums) {
    for (const { pack, documents } of await getPackDocuments("Actor", "actor collection")) {
      for (const actor of documents) add(actor, { pack, locked: isPackLocked(pack) });
    }
  }

  return [...actors.values()];
}

/** Rebuild actor-level backups from effective embedded item configurations. */
export async function rebuildActorItemBackups({ includeCompendiums = false, notify = true } = {}) {
  if (!globalThis.game?.user?.isGM) return { actors: 0, items: 0, failed: 0, skipped: 0 };

  const actors = await collectActors({ includeCompendiums });
  let actorCount = 0;
  let itemCount = 0;
  let failed = 0;
  let skipped = 0;

  for (const { actor, locked } of actors) {
    if (locked) {
      skipped += 1;
      continue;
    }

    try {
      const entries = await withActorBackupQueue(actor, async () => {
        const nextEntries = collectionContents(actor.items)
          .map(item => {
            const config = getStoredItemConfig(item) ?? getActorItemBackupConfig(item);
            return isUsableConfig(config) ? makeBackupEntry(item, config) : null;
          })
          .filter(Boolean);
        await actor.setFlag(MODULE_ID, FLAGS.actorBackup, backupStorePayload(nextEntries));
        return nextEntries;
      });
      actorCount += 1;
      itemCount += entries.length;
    } catch (error) {
      failed += 1;
      console.warn(`${MODULE_ID} | failed to rebuild actor backup`, { actor, error });
    }
  }

  const result = { actors: actorCount, items: itemCount, failed, skipped };
  if (notify) {
    globalThis.ui?.notifications?.info(localizeFormat("FLIS.Tools.BackupDone", result));
  }
  return result;
}

/** Restore missing item flags for all selected actors. */
export async function restoreAllActorItemBackups({ includeCompendiums = false, notify = true } = {}) {
  if (!globalThis.game?.user?.isGM) return { actors: 0, restored: 0, ambiguous: 0, failed: 0, skipped: 0 };

  const actors = await collectActors({ includeCompendiums });
  const total = { actors: 0, restored: 0, ambiguous: 0, failed: 0, skipped: 0 };

  for (const { actor, locked } of actors) {
    if (locked) {
      total.skipped += 1;
      continue;
    }
    total.actors += 1;
    const result = await restoreActorItemBackups(actor);
    total.restored += result.restored ?? 0;
    total.ambiguous += result.ambiguous ?? 0;
    total.failed += result.failed ?? 0;
  }

  if (notify) {
    globalThis.ui?.notifications?.info(localizeFormat("FLIS.Tools.RestoreDone", total));
  }
  return total;
}

/** Audit configured items, playlists, sounds, and ambiguous backup matches. */
export async function auditItemSfxReferences({ includeCompendiums = false, notify = true } = {}) {
  const actors = await collectActors({ includeCompendiums });
  const result = {
    actors: actors.length,
    documents: 0,
    configured: 0,
    missingPlaylist: 0,
    missingSound: 0,
    ambiguousBackup: 0
  };
  const seen = new Set();

  const auditItem = (item, store = null) => {
    const key = String(item?.uuid ?? item?.id ?? "");
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.documents += 1;

    let backupConfig = null;
    if (store) {
      const matching = store.items
        .map(entry => ({ entry, score: scoreBackupEntry(entry, item) }))
        .filter(match => match.score >= BACKUP_MINIMUM_MATCH_SCORE)
        .sort((a, b) => b.score - a.score);
      if (matching.length > 1 && matching[0].score === matching[1].score) {
        result.ambiguousBackup += 1;
      } else if (matching.length) {
        backupConfig = normalizeConfig(matching[0].entry);
      }
    }

    const config = getStoredItemConfig(item) ?? backupConfig;
    if (!config) return;
    result.configured += 1;
    const playlist = globalThis.game?.playlists?.get(config.playlistId);
    if (!playlist) {
      result.missingPlaylist += 1;
      return;
    }
    const sounds = collectionContents(playlist.sounds);
    if (config.soundId === PLAYBACK.random || config.soundId === PLAYBACK.all) {
      if (!sounds.length) result.missingSound += 1;
    } else {
      const sound = playlist.sounds?.get?.(config.soundId)
        ?? sounds.find(entry => entry?.id === config.soundId);
      if (!sound) result.missingSound += 1;
    }
  };

  for (const item of collectionContents(globalThis.game?.items)) auditItem(item);
  for (const { actor } of actors) {
    const store = getActorBackupStore(actor);
    for (const item of collectionContents(actor.items)) auditItem(item, store);
  }

  if (includeCompendiums) {
    for (const { documents } of await getPackDocuments("Item", "reference audit")) {
      for (const item of documents) auditItem(item);
    }
  }

  if (notify) {
    globalThis.ui?.notifications?.info(localizeFormat("FLIS.Tools.AuditDone", result));
  }
  return result;
}

/** Return whether a compendium pack is locked against document updates. */
export function isPackLocked(pack) {
  return !!(pack?.locked ?? pack?.metadata?.locked);
}

/** Read documents from matching compendium packs while isolating pack failures. */
async function getPackDocuments(documentName, warningContext) {
  const results = [];
  for (const pack of globalThis.game?.packs ?? []) {
    const packDocumentName = pack?.documentName ?? pack?.metadata?.type;
    if (packDocumentName !== documentName) continue;
    try {
      results.push({ pack, documents: await pack.getDocuments() });
    } catch (error) {
      console.warn(
        `${MODULE_ID} | failed to read ${documentName} compendium during ${warningContext}`,
        pack?.collection,
        error
      );
    }
  }
  return results;
}

/** Map a source or compendium item to a unique imported actor item. */
export function remapSourceItemToActor(sourceItem, actor) {
  if (!sourceItem || !actor?.items) return null;
  if (sourceItem.parent === actor) return sourceItem;

  const items = collectionContents(actor.items);
  const sourceIds = collectSourceIds(sourceItem);
  const bySource = items.filter(item => {
    const itemSources = collectSourceIds(item);
    return [...sourceIds].some(source => itemSources.has(source));
  });
  if (bySource.length === 1) return bySource[0];

  const signature = getItemSignature(sourceItem);
  const bySignature = items.filter(item => getItemSignature(item) === signature);
  if (bySignature.length === 1) return bySignature[0];

  const byNameTypeImage = items.filter(item => normalizeText(item.name) === normalizeText(sourceItem.name)
    && normalizeItemType(item.type) === normalizeItemType(sourceItem.type)
    && !!item.img && item.img === sourceItem.img);
  if (byNameTypeImage.length === 1) return byNameTypeImage[0];

  const byNameType = items.filter(item => normalizeText(item.name) === normalizeText(sourceItem.name)
    && normalizeItemType(item.type) === normalizeItemType(sourceItem.type));
  if (byNameType.length === 1) return byNameType[0];

  for (const value of sourceIds) {
    const backupMatch = findActorItemFromBackupCandidate(actor, value);
    if (backupMatch) return backupMatch;
  }
  return null;
}

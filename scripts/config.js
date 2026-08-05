import { FLAGS, MODULE_ID } from "./constants.js";
import { normalizeConfig } from "./domain.js";
import { getActorItemBackupConfig } from "./backup.js";
import { localize, safeGetFlag } from "./utils.js";

export function getItemSfxConfig(item) {
  if (!item) return null;

  const raw = safeGetFlag(item, MODULE_ID, FLAGS.config);
  if (raw?.disabled) return null;
  const own = normalizeConfig(raw);
  if (own) return own;

  // Compatibility with early Item SFX versions which stored flat keys.
  const legacyOwn = normalizeConfig({
    playlistId: safeGetFlag(item, MODULE_ID, "playlistId"),
    soundId: safeGetFlag(item, MODULE_ID, "soundId"),
    source: MODULE_ID
  });
  if (legacyOwn) return legacyOwn;

  return getActorItemBackupConfig(item);
}

export async function setItemSfxConfig(item, config, { notify = true } = {}) {
  if (!globalThis.game?.user?.isGM) {
    if (notify) globalThis.ui?.notifications?.warn(localize("FLIS.Warn.GmOnly"));
    return false;
  }
  if (!item) {
    if (notify) globalThis.ui?.notifications?.warn(localize("FLIS.Warn.NoItem"));
    return false;
  }

  const normalized = normalizeConfig(config);
  if (!normalized) return clearItemSfxConfig(item, { notify });

  await item.setFlag(MODULE_ID, FLAGS.config, normalized);
  await item.unsetFlag?.(MODULE_ID, "playlistId");
  await item.unsetFlag?.(MODULE_ID, "soundId");
  if (notify) globalThis.ui?.notifications?.info(localize("FLIS.Notify.Saved"));
  return true;
}

export async function clearItemSfxConfig(item, { notify = true } = {}) {
  if (!globalThis.game?.user?.isGM) {
    if (notify) globalThis.ui?.notifications?.warn(localize("FLIS.Warn.GmOnly"));
    return false;
  }
  if (!item) {
    if (notify) globalThis.ui?.notifications?.warn(localize("FLIS.Warn.NoItem"));
    return false;
  }

  await item.unsetFlag?.(MODULE_ID, FLAGS.config);
  await item.unsetFlag?.(MODULE_ID, "playlistId");
  await item.unsetFlag?.(MODULE_ID, "soundId");
  if (notify) globalThis.ui?.notifications?.info(localize("FLIS.Notify.Cleared"));
  return true;
}

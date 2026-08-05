import {
  DEFAULT_PLAYLIST_NAME,
  MODULE_ID,
  PLAY_MODES,
  SETTINGS
} from "./constants.js";
import { collectionContents } from "./utils.js";

/** Read a module setting and return a fallback when Foundry cannot supply it. */
export function getSetting(key, fallback) {
  try {
    return globalThis.game?.settings?.get(MODULE_ID, key) ?? fallback;
  } catch (_error) {
    return fallback;
  }
}

/** Write a namespaced debug message when client debugging is enabled. */
export function debug(...args) {
  if (!getSetting(SETTINGS.debug, false)) return;
  console.log(`${MODULE_ID} |`, ...args);
}

/** Register module settings and the ApplicationV2 tools menu. */
export function registerSettings(ToolsMenuClass) {
  const settings = globalThis.game?.settings;
  if (!settings) throw new Error(`${MODULE_ID} | game.settings is unavailable`);

  settings.register(MODULE_ID, SETTINGS.enabled, {
    name: "FLIS.Settings.Enabled.Name",
    hint: "FLIS.Settings.Enabled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  settings.register(MODULE_ID, SETTINGS.createPlaylist, {
    name: "FLIS.Settings.CreatePlaylist.Name",
    hint: "FLIS.Settings.CreatePlaylist.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  settings.register(MODULE_ID, SETTINGS.playMode, {
    name: "FLIS.Settings.PlayMode.Name",
    hint: "FLIS.Settings.PlayMode.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      [PLAY_MODES.firstGM]: "FLIS.PlayMode.FirstGM",
      [PLAY_MODES.author]: "FLIS.PlayMode.Author",
      [PLAY_MODES.everyone]: "FLIS.PlayMode.Everyone"
    },
    default: PLAY_MODES.firstGM
  });

  settings.register(MODULE_ID, SETTINGS.debug, {
    name: "FLIS.Settings.Debug.Name",
    hint: "FLIS.Settings.Debug.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  if (ToolsMenuClass && typeof settings.registerMenu === "function") {
    settings.registerMenu(MODULE_ID, SETTINGS.toolsMenu, {
      name: "FLIS.Settings.Tools.Name",
      hint: "FLIS.Settings.Tools.Hint",
      label: "FLIS.Settings.Tools.Label",
      icon: "fa-solid fa-wrench",
      type: ToolsMenuClass,
      restricted: true
    });
  }
}

/** Determine whether the current client should play and broadcast a message SFX. */
export function getPlaybackPolicy(message) {
  const mode = getSetting(SETTINGS.playMode, PLAY_MODES.firstGM);
  const currentUser = globalThis.game?.user ?? null;

  if (mode === PLAY_MODES.everyone) {
    return {
      allowed: true,
      broadcast: false,
      reason: "everyone-local",
      mode,
      currentUserId: currentUser?.id ?? null
    };
  }

  if (mode === PLAY_MODES.author) {
    const authorId = resolveUserId(message?.author)
      ?? resolveUserId(message?.user)
      ?? resolveUserId(message?.userId)
      ?? resolveUserId(message?._source?.user)
      ?? resolveUserId(message?._source?.author);
    const allowed = !!currentUser?.id && String(authorId ?? "") === String(currentUser.id);
    return {
      allowed,
      broadcast: allowed,
      reason: allowed ? "author-broadcast" : "not-author",
      mode,
      authorId: authorId ?? null,
      currentUserId: currentUser?.id ?? null
    };
  }

  const firstGM = getActiveGMs()[0] ?? null;
  const allowed = !!firstGM?.id && !!currentUser?.id && firstGM.id === currentUser.id;
  return {
    allowed,
    broadcast: allowed,
    reason: allowed ? "first-active-gm-broadcast" : "not-first-active-gm",
    mode,
    firstGMId: firstGM?.id ?? null,
    currentUserId: currentUser?.id ?? null
  };
}

/** Return whether the current user is the deterministic first active GM. */
export function isFirstActiveGM() {
  const firstGM = getActiveGMs()[0] ?? null;
  const currentUser = globalThis.game?.user ?? null;
  return !!firstGM?.id && !!currentUser?.id && firstGM.id === currentUser.id;
}

/** Return active GMs in deterministic user-id order. */
function getActiveGMs() {
  return collectionContents(globalThis.game?.users)
    .filter(user => user?.active && user?.isGM && user?.id)
    .sort((a, b) => {
      const left = String(a.id);
      const right = String(b.id);
      return left < right ? -1 : left > right ? 1 : 0;
    });
}

/** Normalize a Foundry user reference to a string identifier. */
function resolveUserId(value) {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  return value.id == null ? null : String(value.id);
}

/** Create the default Item SFX playlist once when the configured GM is authoritative. */
export async function ensureDefaultPlaylist() {
  if (!getSetting(SETTINGS.createPlaylist, true) || !isFirstActiveGM()) return null;
  const existing = globalThis.game?.playlists?.getName?.(DEFAULT_PLAYLIST_NAME);
  if (existing) return existing;
  const PlaylistClass = globalThis.Playlist ?? globalThis.foundry?.documents?.Playlist;
  if (!PlaylistClass?.create) return null;
  return PlaylistClass.create({ name: DEFAULT_PLAYLIST_NAME });
}

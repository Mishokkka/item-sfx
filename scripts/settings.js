import {
  DEFAULT_PLAYLIST_NAME,
  MODULE_ID,
  PLAY_MODES,
  SETTINGS
} from "./constants.js";

export function getSetting(key, fallback) {
  try {
    return globalThis.game?.settings?.get(MODULE_ID, key) ?? fallback;
  } catch (_error) {
    return fallback;
  }
}

export function debug(...args) {
  if (!getSetting(SETTINGS.debug, false)) return;
  console.log(`${MODULE_ID} |`, ...args);
}

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
    const authorId = message?.user?.id ?? message?.user ?? message?.userId ?? message?._source?.user;
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

  const activeGMs = (globalThis.game?.users?.contents ?? Array.from(globalThis.game?.users ?? []))
    .filter(user => user?.active && user?.isGM)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const firstGM = activeGMs[0] ?? null;
  const allowed = firstGM?.id === currentUser?.id;
  return {
    allowed,
    broadcast: allowed,
    reason: allowed ? "first-active-gm-broadcast" : "not-first-active-gm",
    mode,
    firstGMId: firstGM?.id ?? null,
    currentUserId: currentUser?.id ?? null
  };
}

export function isFirstActiveGM() {
  const users = globalThis.game?.users?.contents ?? Array.from(globalThis.game?.users ?? []);
  const firstGM = users
    .filter(user => user?.active && user?.isGM)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
  return firstGM?.id === globalThis.game?.user?.id;
}

export async function ensureDefaultPlaylist() {
  if (!getSetting(SETTINGS.createPlaylist, true) || !isFirstActiveGM()) return null;
  const existing = globalThis.game?.playlists?.getName?.(DEFAULT_PLAYLIST_NAME);
  if (existing) return existing;
  const PlaylistClass = globalThis.Playlist ?? globalThis.foundry?.documents?.Playlist;
  if (!PlaylistClass?.create) return null;
  return PlaylistClass.create({ name: DEFAULT_PLAYLIST_NAME });
}

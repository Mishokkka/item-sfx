export const MODULE_ID = "fl-item-sfx";

export const FLAGS = Object.freeze({
  config: "config",
  actorBackup: "actorItemBackup"
});

export const SETTINGS = Object.freeze({
  enabled: "enabled",
  createPlaylist: "createPlaylist",
  playMode: "playMode",
  debug: "debug",
  toolsMenu: "toolsMenu"
});

export const PLAY_MODES = Object.freeze({
  firstGM: "first-gm",
  author: "author",
  everyone: "everyone"
});

export const PLAYBACK = Object.freeze({
  random: "random-track",
  all: "play-all"
});

export const DEFAULT_PLAYLIST_NAME = "Item SFX";
export const SOCKET_CHANNEL = `module.${MODULE_ID}`;
export const BACKUP_VERSION = 2;
export const BACKUP_MINIMUM_MATCH_SCORE = 30;
export const MESSAGE_FRESHNESS_MS = 20_000;
export const MESSAGE_STATE_TTL_MS = 60_000;
export const MESSAGE_RENDER_WAIT_MS = 2_500;

export const ATTACK_ITEM_TYPES = new Set(["weapon", "monsterattack"]);

export const ROLL_TABLE_SELECTORS = Object.freeze([
  ".table-draw",
  ".table-results",
  ".table-result",
  ".roll-table",
  "[data-roll-table]",
  "[data-roll-table-id]",
  "[data-rolltable-id]"
]);

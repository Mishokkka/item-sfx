import { MODULE_ID, FLAGS } from "./constants.js";
import { registerSettings, ensureDefaultPlaylist, debug, isFirstActiveGM } from "./settings.js";
import { registerAudioSocket, playItemSfx } from "./audio.js";
import {
  auditItemSfxReferences,
  rebuildActorItemBackups,
  removeActorItemBackup,
  restoreActorItemBackups,
  restoreAllActorItemBackups,
  syncActorItemBackup
} from "./backup.js";
import {
  clearItemSfxConfig,
  getItemSfxConfig,
  setItemSfxConfig
} from "./config.js";
import { normalizeConfig } from "./domain.js";
import { enqueueChatMessage } from "./chat/coordinator.js";
import { ItemSfxToolsMenuBridge, openItemSfxForm, openItemSfxTools } from "./ui/dialogs.js";
import { tryInjectItemButton } from "./ui/item-sheet.js";
import { rawFlag } from "./utils.js";

Hooks.once("init", () => {
  registerSettings(ItemSfxToolsMenuBridge);

  globalThis.game.flItemSfx = {
    open: openItemSfxForm,
    openTools: openItemSfxTools,
    getConfig: getItemSfxConfig,
    setConfig: setItemSfxConfig,
    clearConfig: clearItemSfxConfig,
    play: playItemSfx,
    rebuildActorBackups: rebuildActorItemBackups,
    restoreActorBackups: restoreAllActorItemBackups,
    audit: auditItemSfxReferences,
    version: globalThis.game.modules.get(MODULE_ID)?.version ?? "unknown"
  };

  console.info(`${MODULE_ID} | initialized`);
});

Hooks.once("ready", async () => {
  registerAudioSocket();
  try {
    await ensureDefaultPlaylist();
  } catch (error) {
    console.error(`${MODULE_ID} | failed to create the default playlist`, error);
  }

  debug("ready", {
    foundryVersion: globalThis.game?.version ?? globalThis.game?.release?.version,
    foundryGeneration: globalThis.game?.release?.generation,
    build: globalThis.game?.release?.build,
    systemId: globalThis.game?.system?.id,
    systemVersion: globalThis.game?.system?.version,
    moduleVersion: globalThis.game?.modules?.get?.(MODULE_ID)?.version
  });
});

Hooks.on("renderItemSheet", (app, html, context) => {
  tryInjectItemButton(app, html, context);
});

Hooks.on("renderApplicationV2", (app, element, context, options) => {
  tryInjectItemButton(app, element, context, options);
});

Hooks.on("createChatMessage", (message, options, userId) => {
  enqueueChatMessage(message, null, { hook: "createChatMessage", options, userId });
});

Hooks.on("renderChatMessageHTML", (message, html, context) => {
  enqueueChatMessage(message, html, { hook: "renderChatMessageHTML", ...(context ?? {}) });
});

Hooks.on("createActor", actor => {
  if (!isFirstActiveGM()) return;
  globalThis.setTimeout(() => void restoreActorItemBackups(actor), 0);
});

Hooks.on("createItem", item => {
  if (!isFirstActiveGM()) return;
  const config = getOwnConfigFromRaw(item);
  if (config && item?.parent?.documentName === "Actor") void syncActorItemBackup(item, config);
});

Hooks.on("updateItem", (item, changes) => {
  if (!isFirstActiveGM()) return;
  if (!item?.parent || item.parent.documentName !== "Actor") return;
  if (!itemConfigWasChanged(changes)) return;
  const config = getOwnConfigFromRaw(item);
  if (config) void syncActorItemBackup(item, config);
  else void removeActorItemBackup(item);
});

Hooks.on("deleteItem", item => {
  if (!isFirstActiveGM()) return;
  if (item?.parent?.documentName === "Actor") void removeActorItemBackup(item);
});

function getOwnConfigFromRaw(item) {
  const raw = rawFlag(item, MODULE_ID, FLAGS.config);
  if (raw?.disabled) return null;
  return normalizeConfig(raw);
}

function itemConfigWasChanged(changes) {
  if (!changes || typeof changes !== "object") return false;
  if (Object.hasOwn(changes, `flags.${MODULE_ID}.${FLAGS.config}`)) return true;
  if (Object.hasOwn(changes, `flags.${MODULE_ID}.-=${FLAGS.config}`)) return true;
  const namespace = changes.flags?.[MODULE_ID];
  return !!namespace && (
    Object.hasOwn(namespace, FLAGS.config)
    || Object.hasOwn(namespace, `-=${FLAGS.config}`)
  );
}

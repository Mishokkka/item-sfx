import { MODULE_ID, PLAYBACK } from "../constants.js";
import {
  auditItemSfxReferences,
  rebuildActorItemBackups,
  restoreAllActorItemBackups
} from "../backup.js";
import { clearItemSfxConfig, getItemSfxConfig, setItemSfxConfig } from "../config.js";
import {
  asHTMLElement,
  asHTMLElementFromArgs,
  collectionContents,
  escapeHtml,
  localize
} from "../utils.js";

/** Create the minimal ApplicationV2 bridge used by settings.registerMenu. */
export function getItemSfxToolsMenuBridge() {
  const ApplicationV2Base = globalThis.foundry?.applications?.api?.ApplicationV2;
  if (!ApplicationV2Base) {
    throw new Error(`${MODULE_ID} | ApplicationV2 is unavailable during settings registration`);
  }

  return class ItemSfxToolsMenuBridge extends ApplicationV2Base {
    static DEFAULT_OPTIONS = {
      id: "flis-tools-bridge",
      window: { title: "FLIS.Tools.Title" },
      position: { width: 1, height: 1 }
    };

    /** Open the tools dialog when Foundry renders the settings-menu bridge. */
    render(..._args) {
      void openItemSfxTools();
      return this;
    }

    /** Provide an inert render result for the settings-menu bridge. */
    async _renderHTML() {
      return globalThis.document?.createElement?.("div") ?? "";
    }

    /** Suppress DOM replacement for the settings-menu bridge. */
    _replaceHTML() {}
  };
}

/** Return the current Foundry DialogV2 implementation. */
function getDialogV2() {
  return globalThis.foundry?.applications?.api?.DialogV2;
}

/** Resolve an Item from a direct document or sheet-like argument. */
function getItemFromArgument(itemOrApp) {
  if (itemOrApp?.documentName === "Item") return itemOrApp;
  for (const candidate of [itemOrApp?.document, itemOrApp?.object, itemOrApp?.item, itemOrApp?.options?.document]) {
    if (candidate?.documentName === "Item") return candidate;
  }
  return null;
}

/** Open the GM configuration dialog for one attack-capable item. */
export async function openItemSfxForm(itemOrApp) {
  if (!globalThis.game?.user?.isGM) {
    globalThis.ui?.notifications?.warn(localize("FLIS.Warn.GmOnly"));
    return;
  }

  const item = getItemFromArgument(itemOrApp);
  if (!item) {
    globalThis.ui?.notifications?.warn(localize("FLIS.Warn.NoItem"));
    return;
  }

  const DialogV2 = getDialogV2();
  if (!DialogV2) throw new Error(`${MODULE_ID} | DialogV2 is unavailable in this Foundry version`);

  const current = getItemSfxConfig(item) ?? { playlistId: "", soundId: "" };
  let dialogRoot = null;

  const result = await DialogV2.wait({
    window: { title: `${localize("FLIS.ConfigureTitle")}: ${item.name}` },
    content: buildItemDialogContent(current),
    classes: [MODULE_ID, "flis-item-dialog"],
    rejectClose: false,
    modal: false,
    render: (...args) => {
      dialogRoot = asHTMLElementFromArgs(args);
      wireItemDialog(dialogRoot, current.soundId);
    },
    buttons: [
      {
        action: "save",
        label: "FLIS.Save",
        icon: "fa-solid fa-floppy-disk",
        default: true,
        callback: () => ({
          action: "save",
          playlistId: dialogRoot?.querySelector?.("[name='playlistId']")?.value ?? "",
          soundId: dialogRoot?.querySelector?.("[name='soundId']")?.value ?? ""
        })
      },
      {
        action: "clear",
        label: "FLIS.Delete",
        icon: "fa-solid fa-trash",
        callback: () => ({ action: "clear" })
      },
      {
        action: "cancel",
        label: "FLIS.Cancel",
        icon: "fa-solid fa-xmark",
        callback: () => null
      }
    ]
  });

  if (!result) return;
  if (result.action === "clear") return clearItemSfxConfig(item);
  if (result.action === "save") {
    if (!result.playlistId || !result.soundId) return clearItemSfxConfig(item);
    return setItemSfxConfig(item, result);
  }
}

/** Build escaped playlist and sound controls for the item dialog. */
function buildItemDialogContent(current) {
  const playlistOptions = collectionContents(globalThis.game?.playlists).map(playlist => {
    const selected = playlist.id === current.playlistId ? " selected" : "";
    return `<option value="${escapeHtml(playlist.id)}"${selected}>${escapeHtml(playlist.name)}</option>`;
  }).join("");

  return `
    <section class="flis-form">
      <div class="form-group">
        <label>${localize("FLIS.Playlist")}</label>
        <select name="playlistId" class="flis-playlist-select">
          <option value="">${localize("FLIS.None")}</option>
          ${playlistOptions}
        </select>
        <p class="notes">${localize("FLIS.PlaylistNotes")}</p>
      </div>
      <div class="form-group">
        <label>${localize("FLIS.Sound")}</label>
        <select name="soundId" class="flis-sound-select" data-current="${escapeHtml(current.soundId ?? "")}"></select>
        <p class="notes">${localize("FLIS.SoundNotes")}</p>
      </div>
    </section>`;
}

/** Populate and synchronize sound choices with the selected playlist. */
function wireItemDialog(rootValue, currentSoundId = "") {
  const root = asHTMLElement(rootValue);
  const playlistSelect = root?.querySelector?.(".flis-playlist-select");
  const soundSelect = root?.querySelector?.(".flis-sound-select");
  if (!playlistSelect || !soundSelect) return;

  const fillSounds = () => {
    const playlist = globalThis.game?.playlists?.get?.(playlistSelect.value);
    const sounds = collectionContents(playlist?.sounds);
    const selected = soundSelect.dataset.current ?? currentSoundId ?? "";

    soundSelect.replaceChildren(new globalThis.Option(localize("FLIS.None"), ""));
    if (sounds.length) {
      soundSelect.append(new globalThis.Option(localize("FLIS.Random"), PLAYBACK.random));
      soundSelect.append(new globalThis.Option(localize("FLIS.PlayAll"), PLAYBACK.all));
    }
    for (const sound of sounds) soundSelect.append(new globalThis.Option(sound.name, sound.id));

    soundSelect.value = [...soundSelect.options].some(option => option.value === selected) ? selected : "";
    soundSelect.dataset.current = soundSelect.value;
  };

  playlistSelect.addEventListener("change", () => {
    soundSelect.dataset.current = "";
    fillSounds();
  });
  soundSelect.addEventListener("change", () => {
    soundSelect.dataset.current = soundSelect.value;
  });
  fillSounds();
}

/** Open the GM maintenance menu and dispatch the selected operation. */
export async function openItemSfxTools() {
  if (!globalThis.game?.user?.isGM) {
    globalThis.ui?.notifications?.warn(localize("FLIS.Warn.GmOnly"));
    return;
  }

  const DialogV2 = getDialogV2();
  if (!DialogV2) throw new Error(`${MODULE_ID} | DialogV2 is unavailable in this Foundry version`);

  let toolsRoot = null;
  const result = await DialogV2.wait({
    window: { title: localize("FLIS.Tools.Title") },
    content: `
      <section class="flis-tools-form">
        <p>${localize("FLIS.Tools.Explanation")}</p>
        <p class="notes">${localize("FLIS.Tools.BackupNotes")}</p>
        <p class="notes">${localize("FLIS.Tools.RestoreNotes")}</p>
        <p class="notes">${localize("FLIS.Tools.AuditNotes")}</p>
        <label class="flis-tools-option">
          <input type="checkbox" name="includeCompendiums">
          <span>${localize("FLIS.Tools.IncludeCompendiums")}</span>
        </label>
      </section>`,
    classes: [MODULE_ID, "flis-tools-dialog"],
    rejectClose: false,
    modal: false,
    render: (...args) => {
      toolsRoot = asHTMLElementFromArgs(args);
    },
    buttons: [
      {
        action: "restore",
        label: "FLIS.Tools.Restore",
        icon: "fa-solid fa-rotate-left",
        callback: () => ({
          action: "restore",
          includeCompendiums: !!toolsRoot?.querySelector?.("[name='includeCompendiums']")?.checked
        })
      },
      {
        action: "backup",
        label: "FLIS.Tools.Backup",
        icon: "fa-solid fa-shield-halved",
        callback: () => ({
          action: "backup",
          includeCompendiums: !!toolsRoot?.querySelector?.("[name='includeCompendiums']")?.checked
        })
      },
      {
        action: "audit",
        label: "FLIS.Tools.Audit",
        icon: "fa-solid fa-magnifying-glass",
        callback: () => ({
          action: "audit",
          includeCompendiums: !!toolsRoot?.querySelector?.("[name='includeCompendiums']")?.checked
        })
      },
      {
        action: "close",
        label: "FLIS.Close",
        icon: "fa-solid fa-xmark",
        callback: () => null
      }
    ]
  });

  if (!result) return;
  if (result.action === "audit") {
    return auditItemSfxReferences({ includeCompendiums: result.includeCompendiums });
  }
  if (result.action === "backup" || result.action === "restore") {
    const confirmed = await confirmMaintenanceAction(DialogV2, result.action, result.includeCompendiums);
    if (!confirmed) return;
    if (result.action === "backup") {
      return rebuildActorItemBackups({ includeCompendiums: result.includeCompendiums });
    }
    return restoreAllActorItemBackups({ includeCompendiums: result.includeCompendiums });
  }
}

/** Require explicit confirmation before a document-changing maintenance action. */
async function confirmMaintenanceAction(DialogV2, action, includeCompendiums) {
  const actionKey = action === "backup" ? "Backup" : "Restore";
  const result = await DialogV2.wait({
    window: { title: localize(`FLIS.Tools.Confirm${actionKey}Title`) },
    content: `
      <section class="flis-tools-confirmation">
        <p>${localize(`FLIS.Tools.Confirm${actionKey}`)}</p>
        ${includeCompendiums ? `<p class="warning">${localize("FLIS.Tools.CompendiumWarning")}</p>` : ""}
      </section>`,
    classes: [MODULE_ID, "flis-tools-confirm-dialog"],
    rejectClose: false,
    modal: true,
    buttons: [
      {
        action: "confirm",
        label: "FLIS.Tools.Confirm",
        icon: "fa-solid fa-triangle-exclamation",
        default: false,
        callback: () => true
      },
      {
        action: "cancel",
        label: "FLIS.Cancel",
        icon: "fa-solid fa-xmark",
        default: true,
        callback: () => false
      }
    ]
  });
  return result === true;
}

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

const ApplicationV2Base = globalThis.foundry?.applications?.api?.ApplicationV2
  ?? class ItemSfxUnavailableApplicationV2 {};

export class ItemSfxToolsMenuBridge extends ApplicationV2Base {
  static DEFAULT_OPTIONS = {
    id: "flis-tools-bridge",
    window: { title: "FLIS.Tools.Title" },
    position: { width: 1, height: 1 }
  };

  render(..._args) {
    void openItemSfxTools();
    return this;
  }

  async _renderHTML() {
    return globalThis.document?.createElement?.("div") ?? "";
  }

  _replaceHTML() {}
}

function getDialogV2() {
  return globalThis.foundry?.applications?.api?.DialogV2;
}

function getItemFromArgument(itemOrApp) {
  if (itemOrApp?.documentName === "Item") return itemOrApp;
  for (const candidate of [itemOrApp?.document, itemOrApp?.object, itemOrApp?.item, itemOrApp?.options?.document]) {
    if (candidate?.documentName === "Item") return candidate;
  }
  return null;
}

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

export async function openItemSfxTools() {
  if (!globalThis.game?.user?.isGM) {
    globalThis.ui?.notifications?.warn(localize("FLIS.Warn.GmOnly"));
    return;
  }

  const DialogV2 = getDialogV2();
  if (!DialogV2) throw new Error(`${MODULE_ID} | DialogV2 is unavailable in this Foundry version`);

  const result = await DialogV2.wait({
    window: { title: localize("FLIS.Tools.Title") },
    content: `
      <section class="flis-tools-form">
        <p>${localize("FLIS.Tools.Explanation")}</p>
        <p class="notes">${localize("FLIS.Tools.BackupNotes")}</p>
        <p class="notes">${localize("FLIS.Tools.RestoreNotes")}</p>
        <p class="notes">${localize("FLIS.Tools.AuditNotes")}</p>
      </section>`,
    classes: [MODULE_ID, "flis-tools-dialog"],
    rejectClose: false,
    modal: false,
    buttons: [
      {
        action: "restore",
        label: "FLIS.Tools.Restore",
        icon: "fa-solid fa-rotate-left",
        callback: () => "restore"
      },
      {
        action: "backup",
        label: "FLIS.Tools.Backup",
        icon: "fa-solid fa-shield-halved",
        callback: () => "backup"
      },
      {
        action: "audit",
        label: "FLIS.Tools.Audit",
        icon: "fa-solid fa-magnifying-glass",
        callback: () => "audit"
      },
      {
        action: "close",
        label: "FLIS.Close",
        icon: "fa-solid fa-xmark",
        callback: () => null
      }
    ]
  });

  if (result === "backup") return rebuildActorItemBackups({ includeCompendiums: true });
  if (result === "restore") return restoreAllActorItemBackups({ includeCompendiums: true });
  if (result === "audit") return auditItemSfxReferences({ includeCompendiums: true });
}

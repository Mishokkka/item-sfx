import { SETTINGS } from "../constants.js";
import { isAttackCapableItem } from "../domain.js";
import { getSetting } from "../settings.js";
import { asHTMLElement, localize } from "../utils.js";
import { openItemSfxForm } from "./dialogs.js";

/** Resolve an Item document from a legacy or ApplicationV2 sheet instance. */
function getItemFromApp(app) {
  for (const candidate of [app?.document, app?.object, app?.item, app?.options?.document]) {
    if (candidate?.documentName === "Item") return candidate;
  }
  return null;
}

/** Resolve an Item document from a sheet-render context object. */
function getItemFromContext(context) {
  for (const candidate of [context?.item, context?.document, context?.object]) {
    if (candidate?.documentName === "Item") return candidate;
  }
  return null;
}

/** Check user, document type, module state, and editability before showing controls. */
function canConfigureItem(app, item) {
  return !!(
    getSetting(SETTINGS.enabled, true)
    && globalThis.game?.user?.isGM
    && item
    && isAttackCapableItem(item)
    && app?.isEditable !== false
    && item?.sheet?.isEditable !== false
  );
}

/** Insert the Item SFX configuration button into a sheet window header. */
function injectButton(frame, item) {
  const header = frame?.querySelector?.(".window-header, header.window-header");
  if (!header || header.querySelector(".flis-header-button")) return;

  const button = globalThis.document.createElement("button");
  button.type = "button";
  button.className = "flis-header-button";
  button.title = localize("FLIS.ConfigureTitle");
  button.setAttribute("aria-label", localize("FLIS.ConfigureTitle"));
  button.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    void openItemSfxForm(item);
  });

  const close = header.querySelector("[data-action='close'], .close");
  if (close) close.before(button);
  else header.append(button);
}

/** Safely schedule Item SFX button injection for supported sheet hooks. */
export function tryInjectItemButton(app, html, context, options) {
  try {
    const item = getItemFromApp(app) ?? getItemFromContext(context) ?? getItemFromContext(options);
    if (!canConfigureItem(app, item)) return;
    const root = asHTMLElement(html);

    globalThis.setTimeout(() => {
      const frame = asHTMLElement(app?.element) ?? root?.closest?.(".app, .application, .window-app") ?? root;
      if (frame) injectButton(frame, item);
    }, 0);
  } catch (error) {
    console.error("fl-item-sfx | item sheet button injection failed", error);
  }
}

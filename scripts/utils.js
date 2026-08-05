/** Convert Foundry collections, arrays, and iterables to a plain array. */
export function collectionContents(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  try {
    return Array.from(collection);
  } catch (_error) {
    return [];
  }
}

/** Normalize text for locale-independent matching. */
export function normalizeText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Extract readable text from an HTML fragment. */
export function stripHtml(value) {
  const text = String(value ?? "");
  if (!text.includes("<")) return text;

  if (globalThis.document?.createElement) {
    const div = globalThis.document.createElement("div");
    div.innerHTML = text;
    return div.textContent ?? div.innerText ?? "";
  }

  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Escape a value for safe insertion into generated HTML. */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Normalize, remove blanks, and deduplicate string values. */
export function uniqueStrings(values) {
  return [...new Set((values ?? [])
    .map(value => String(value ?? "").trim())
    .filter(Boolean))];
}

/** Clamp a finite numeric value to an inclusive range. */
export function clamp(value, minimum = 0, maximum = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

/** Read a raw flag from document data without depending on document methods. */
export function rawFlag(document, scope, key) {
  if (!document || !scope || !key) return undefined;

  for (const source of [document.flags, document._source?.flags]) {
    try {
      const value = source?.[scope]?.[key];
      if (value !== undefined) return value;
    } catch (_error) {
      // Try the next representation.
    }
  }

  try {
    return document.toObject?.()?.flags?.[scope]?.[key];
  } catch (_error) {
    return undefined;
  }
}

/** Read a document flag with raw-data fallback for partially initialized documents. */
export function safeGetFlag(document, scope, key) {
  if (!document) return undefined;
  try {
    const value = document.getFlag?.(scope, key);
    return value === undefined ? rawFlag(document, scope, key) : value;
  } catch (_error) {
    return rawFlag(document, scope, key);
  }
}

/** Resolve supported Foundry wrapper values to an HTMLElement. */
export function asHTMLElement(value) {
  const HTMLElementClass = globalThis.HTMLElement;
  if (!value || !HTMLElementClass) return null;
  if (value instanceof HTMLElementClass) return value;
  if (Array.isArray(value)) return value.find(entry => entry instanceof HTMLElementClass) ?? null;
  if (value[0] instanceof HTMLElementClass) return value[0];
  if (value.element instanceof HTMLElementClass) return value.element;
  if (value[0]?.element instanceof HTMLElementClass) return value[0].element;
  return null;
}

/** Find the first HTMLElement contained in a hook argument list. */
export function asHTMLElementFromArgs(args) {
  for (const argument of args ?? []) {
    const element = asHTMLElement(argument);
    if (element) return element;
  }
  for (const argument of args ?? []) {
    const element = asHTMLElement(argument?.element ?? argument?.html);
    if (element) return element;
  }
  return null;
}

/** Resolve a localization key with a key fallback. */
export function localize(key) {
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

/** Format a localization key with a key fallback. */
export function localizeFormat(key, data) {
  return globalThis.game?.i18n?.format?.(key, data) ?? key;
}

/** Validate a plausible Foundry document identifier. */
export function isDocumentId(value) {
  return /^[A-Za-z0-9_-]{8,64}$/.test(String(value ?? "").trim());
}

/** Validate a bounded Foundry document UUID prefix. */
export function isDocumentUuid(value) {
  const text = String(value ?? "").trim();
  return /^(Item|Actor|Scene|Compendium)\./.test(text) && text.length <= 512;
}


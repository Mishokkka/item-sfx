import {
  MESSAGE_FRESHNESS_MS,
  MESSAGE_RENDER_WAIT_MS,
  MESSAGE_STATE_TTL_MS,
  SETTINGS
} from "../constants.js";
import { getItemSfxConfig } from "../config.js";
import { playItemSfx } from "../audio.js";
import { debug, getPlaybackPolicy, getSetting } from "../settings.js";
import { asHTMLElement } from "../utils.js";
import { analyzeAttackMessage, getRollCount } from "./resolver.js";

const states = new Map();

function getMessageTimestamp(message) {
  const timestamp = Number(message?.timestamp ?? message?._source?.timestamp ?? 0);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isFreshMessage(message) {
  const timestamp = getMessageTimestamp(message);
  if (!timestamp) return true;
  const age = Date.now() - timestamp;
  return age < 0 || age <= MESSAGE_FRESHNESS_MS;
}

function cleanupState(id, state, delay = MESSAGE_STATE_TTL_MS) {
  clearTimeout(state.cleanupTimer);
  state.cleanupTimer = setTimeout(() => {
    if (states.get(id) === state) states.delete(id);
  }, delay);
}

function getState(message) {
  const id = message?.id;
  if (!id) return null;
  let state = states.get(id);
  if (!state) {
    state = {
      id,
      message,
      root: null,
      contexts: [],
      timer: null,
      cleanupTimer: null,
      processing: false,
      dirty: false,
      done: false,
      attempts: 0,
      renderWait: false
    };
    states.set(id, state);
    if (states.size > 500) {
      const oldest = states.keys().next().value;
      if (oldest) states.delete(oldest);
    }
  }
  return state;
}

export function enqueueChatMessage(message, html = null, context = {}) {
  if (!getSetting(SETTINGS.enabled, true) || !message?.id) return;
  const state = getState(message);
  if (!state || state.done) return;

  state.message = message;
  const root = asHTMLElement(html);
  if (root) state.root = root;
  state.contexts.push(context ?? {});
  if (state.contexts.length > 5) state.contexts.shift();
  state.dirty = true;

  clearTimeout(state.timer);
  const delay = root ? 0 : 100;
  state.timer = setTimeout(() => void processState(state), delay);
  cleanupState(state.id, state);
}

async function processState(state) {
  if (state.done) return;
  if (state.processing) {
    state.dirty = true;
    return;
  }

  state.processing = true;
  state.dirty = false;
  state.attempts += 1;

  try {
    const message = state.message;
    const policy = getPlaybackPolicy(message);
    debug("message processing", {
      messageId: message?.id,
      attempt: state.attempts,
      hasRenderedHtml: !!state.root,
      rollCount: getRollCount(message),
      policy
    });

    if (!policy.allowed) {
      state.done = true;
      return;
    }
    if (!isFreshMessage(message)) {
      debug("message ignored", { messageId: message?.id, reason: "stale-message" });
      state.done = true;
      return;
    }

    const context = Object.assign({}, ...state.contexts);
    const analysis = await analyzeAttackMessage(message, state.root, context);
    debug("message analysis", {
      messageId: message?.id,
      status: analysis.status,
      reason: analysis.reason,
      candidateCount: analysis.metadata?.candidates?.length ?? 0,
      item: analysis.item ? {
        id: analysis.item.id,
        uuid: analysis.item.uuid,
        name: analysis.item.name,
        type: analysis.item.type
      } : null
    });

    if (analysis.status === "needs-render" && !state.root) {
      state.renderWait = true;
      return;
    }

    if (analysis.status !== "matched") {
      state.done = true;
      return;
    }

    const config = getItemSfxConfig(analysis.item);
    if (!config) {
      debug("message ignored", {
        messageId: message?.id,
        reason: "resolved-item-has-no-config",
        item: { id: analysis.item.id, uuid: analysis.item.uuid, name: analysis.item.name }
      });
      state.done = true;
      return;
    }

    // Mark before awaiting audio to close the create/render race window.
    state.done = true;
    const result = await playItemSfx(config, { broadcast: policy.broadcast });
    debug("sound playback", {
      messageId: message?.id,
      item: { id: analysis.item.id, uuid: analysis.item.uuid, name: analysis.item.name },
      config,
      result,
      broadcast: policy.broadcast
    });
  } catch (error) {
    state.done = true;
    console.error("fl-item-sfx | failed to process ChatMessage", error);
  } finally {
    state.processing = false;
    if (!state.done && state.dirty) {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => void processState(state), 0);
    }
    cleanupState(state.id, state, state.renderWait ? MESSAGE_RENDER_WAIT_MS : MESSAGE_STATE_TTL_MS);
  }
}

export function resetMessageCoordinator() {
  for (const state of states.values()) {
    clearTimeout(state.timer);
    clearTimeout(state.cleanupTimer);
  }
  states.clear();
}

import { MODULE_ID, PLAYBACK, SOCKET_CHANNEL } from "./constants.js";
import { normalizeConfig } from "./domain.js";
import { getSetting, debug } from "./settings.js";
import { SETTINGS } from "./constants.js";
import { clamp, collectionContents, localize } from "./utils.js";

let socketRegistered = false;

export function registerAudioSocket() {
  if (socketRegistered || !globalThis.game?.socket?.on) return;
  socketRegistered = true;
  globalThis.game.socket.on(SOCKET_CHANNEL, async payload => {
    if (!getSetting(SETTINGS.enabled, true)) return;
    if (!payload || payload.type !== "play-sfx") return;
    if (payload.senderId && payload.senderId === globalThis.game?.user?.id) return;
    const src = String(payload.src ?? "").trim();
    if (!src || src.length > 2048 || !isAuthorizedPlaylistSound(payload, src)) return;
    try {
      await playLocalSound(src, clamp(payload.volume ?? 0.8));
    } catch (error) {
      console.warn(`${MODULE_ID} | failed to play socket-delivered SFX`, { src, error });
    }
  });
}

export async function playItemSfx(config, { broadcast = true } = {}) {
  const normalized = normalizeConfig(config);
  if (!normalized) return { played: 0, failed: 0 };

  const playlist = globalThis.game?.playlists?.get(normalized.playlistId);
  if (!playlist) {
    globalThis.ui?.notifications?.warn(localize("FLIS.Warn.NoPlaylist"));
    return { played: 0, failed: 1 };
  }

  const sounds = collectionContents(playlist.sounds);
  let selected = [];
  if (normalized.soundId === PLAYBACK.all) selected = sounds;
  else if (normalized.soundId === PLAYBACK.random) {
    if (sounds.length) selected = [sounds[Math.floor(Math.random() * sounds.length)]];
  } else {
    const sound = playlist.sounds?.get?.(normalized.soundId)
      ?? sounds.find(entry => entry.id === normalized.soundId);
    if (sound) selected = [sound];
  }

  if (!selected.length) {
    globalThis.ui?.notifications?.warn(localize("FLIS.Warn.NoSound"));
    return { played: 0, failed: 1 };
  }

  const results = await Promise.allSettled(selected.map(sound => playPlaylistSound(sound, playlist, { broadcast })));
  const failures = results.filter(result => result.status === "rejected");
  for (const failure of failures) {
    console.warn(`${MODULE_ID} | failed to play Item SFX`, failure.reason);
  }
  return {
    played: results.length - failures.length,
    failed: failures.length
  };
}

async function playPlaylistSound(sound, playlist, { broadcast }) {
  const src = String(sound?.path ?? sound?.src ?? sound?.file ?? "").trim();
  if (!src) throw new Error(`${MODULE_ID} | PlaylistSound has no source path`);
  const volume = clamp(Number.isFinite(Number(sound?.volume))
    ? Number(sound.volume)
    : Number.isFinite(Number(playlist?.volume))
      ? Number(playlist.volume)
      : 0.8);

  await playLocalSound(src, volume);
  if (broadcast) broadcastSound(src, volume, { playlistId: playlist.id, soundId: sound.id });
  return true;
}

function isAuthorizedPlaylistSound(payload, src) {
  const playlistId = String(payload?.playlistId ?? "").trim();
  const soundId = String(payload?.soundId ?? "").trim();
  if (!playlistId || !soundId) return false;
  const playlist = globalThis.game?.playlists?.get?.(playlistId);
  const sound = playlist?.sounds?.get?.(soundId)
    ?? collectionContents(playlist?.sounds).find(entry => entry.id === soundId);
  const knownSrc = String(sound?.path ?? sound?.src ?? sound?.file ?? "").trim();
  return !!knownSrc && knownSrc === src;
}

function broadcastSound(src, volume, { playlistId, soundId }) {
  const socket = globalThis.game?.socket;
  if (socket?.emit) {
    socket.emit(SOCKET_CHANNEL, {
      type: "play-sfx",
      src,
      volume,
      senderId: globalThis.game?.user?.id ?? null,
      playlistId,
      soundId
    });
    return;
  }

  // Last-resort compatibility path if the module socket is unavailable.
  const helper = globalThis.AudioHelper ?? globalThis.foundry?.audio?.AudioHelper;
  if (helper?.play) helper.play({ src, volume, autoplay: true, loop: false }, true);
}

export async function playLocalSound(src, volume = 0.8) {
  const SoundClass = globalThis.foundry?.audio?.Sound ?? globalThis.Sound;
  if (SoundClass) {
    const options = globalThis.game?.audio?.environment
      ? { context: globalThis.game.audio.environment }
      : {};
    const sound = new SoundClass(src, options);
    await sound.load();
    await sound.play({ volume: clamp(volume), loop: false });
    return sound;
  }

  const helper = globalThis.AudioHelper ?? globalThis.foundry?.audio?.AudioHelper;
  if (helper?.play) return helper.play({ src, volume: clamp(volume), autoplay: true, loop: false }, false);

  debug("audio unavailable", { src });
  throw new Error(`${MODULE_ID} | No compatible Foundry audio API is available`);
}

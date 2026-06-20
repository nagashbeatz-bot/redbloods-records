"use client";

import { createContext, useContext, useState, useRef, useEffect, useCallback } from "react";

// ── Channels ──────────────────────────────────────────────────────────────────
export const RADIO_CHANNELS = [
  {
    id: "main",
    label: "Jahkno! Main",
    url: "https://streaming.radio.co/s00d41a200/listen",
    artwork: "https://jahknoradio.com/wp-content/uploads/2021/01/jahkno-radio-main-370x370.webp",
  },
  {
    id: "dancehall",
    label: "Dancehall Reggae",
    url: "http://stream.zeno.fm/7qrr5rm9g0hvv",
    artwork: "https://jahknoradio.com/wp-content/uploads/2025/03/jahkno-radio-dancehall-reggae-370x370.webp",
  },
  {
    id: "hiphop",
    label: "Hip-Hop × R&B",
    url: "http://stream.zeno.fm/4k3px7s9g0hvv",
    artwork: "https://jahknoradio.com/wp-content/uploads/2025/03/jahkno-radio-hip-hop-370x370.webp",
  },
  {
    id: "afrobeats",
    label: "Afrobeats × Amapiano",
    url: "http://stream.zeno.fm/n95vb4dah0hvv",
    artwork: "https://jahknoradio.com/wp-content/uploads/2025/03/jahkno-radio-afrobeats-amapiano-370x370.webp",
  },
  {
    id: "gospel",
    label: "Gospel",
    url: "https://stream.zeno.fm/azvi4fweulauv",
    artwork: "https://jahknoradio.com/wp-content/uploads/2025/03/jahkno-radio-gospel-370x370.webp",
  },
  {
    id: "trending",
    label: "Trending",
    url: "https://stream-163.zeno.fm/ce1jvste7tpuv",
    artwork: "https://jahknoradio.com/wp-content/uploads/2025/03/Jahkno-Radio-Trending-370x370.jpg",
  },
] as const;

export type ChannelId = (typeof RADIO_CHANNELS)[number]["id"];

// ── Fade helpers (module-level — no closure issues) ───────────────────────────
const FADE_STEP_MS = 40; // ~25fps

function startFadeOut(
  audio: HTMLAudioElement,
  durationMs: number,
  timerRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
  onDone: () => void,
) {
  if (timerRef.current) clearInterval(timerRef.current);
  const startVol = audio.volume;
  const steps    = Math.max(1, Math.round(durationMs / FADE_STEP_MS));
  let step = 0;
  timerRef.current = setInterval(() => {
    step++;
    audio.volume = Math.max(0, startVol * (1 - step / steps));
    if (step >= steps) {
      clearInterval(timerRef.current!);
      timerRef.current = null;
      audio.volume = 0;
      onDone();
    }
  }, FADE_STEP_MS);
}

function startFadeIn(
  audio: HTMLAudioElement,
  durationMs: number,
  targetVol: number,
  timerRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
) {
  if (timerRef.current) clearInterval(timerRef.current);
  audio.volume = 0;
  const steps  = Math.max(1, Math.round(durationMs / FADE_STEP_MS));
  let step = 0;
  timerRef.current = setInterval(() => {
    step++;
    audio.volume = Math.min(targetVol, targetVol * (step / steps));
    if (step >= steps) {
      clearInterval(timerRef.current!);
      timerRef.current = null;
      audio.volume = targetVol;
    }
  }, FADE_STEP_MS);
}

// ── Context type ──────────────────────────────────────────────────────────────
interface RadioContextValue {
  playing:      boolean;
  loading:      boolean;
  channel:      ChannelId;
  volume:       number;
  panelOpen:    boolean;
  play:         (channelId?: ChannelId) => void;
  pause:        () => void;
  stop:         () => void;
  setChannel:   (id: ChannelId) => void;
  setVolume:    (v: number) => void;
  setPanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
}

const RadioContext = createContext<RadioContextValue | null>(null);

export function useRadio(): RadioContextValue {
  const ctx = useContext(RadioContext);
  if (!ctx) throw new Error("useRadio must be used within RadioProvider");
  return ctx;
}

export function useRadioSafe(): RadioContextValue | null {
  return useContext(RadioContext);
}

// ── Provider ──────────────────────────────────────────────────────────────────
export default function RadioProvider({ children }: { children: React.ReactNode }) {
  // ── Audio element ref (one for the app lifetime) ───────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ── Refs that mirror state — used inside event handlers / intervals
  //    to avoid stale closures without adding them as useEffect deps ──────────
  const channelRef    = useRef<ChannelId>("main");
  const playingRef    = useRef(false);
  const volumeRef     = useRef(80);

  // ── Coordination refs ─────────────────────────────────────────────────────
  const wasProjectRef  = useRef(false); // radio was playing when project started
  const fadeTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const firstPlayRef   = useRef<(() => void) | null>(null); // pending fade-in listener

  // ── UI state ──────────────────────────────────────────────────────────────
  const [playing,   setPlaying]   = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [channel,   setChannelState] = useState<ChannelId>("main");
  const [volume,    setVolumeState]  = useState(80);
  const [panelOpen, setPanelOpen]    = useState(false);

  // ── Create audio element once — lives for the entire app session ───────────
  useEffect(() => {
    const audio    = new Audio();
    audio.preload  = "none";
    audio.volume   = volumeRef.current / 100;
    audioRef.current = audio;

    const onPlaying = () => { setPlaying(true);  setLoading(false); playingRef.current = true;  };
    const onPause   = () => { setPlaying(false);                    playingRef.current = false; };
    const onWaiting = () =>   setLoading(true);
    const onError   = () => { setPlaying(false); setLoading(false); playingRef.current = false; };
    const onStalled = () =>   setLoading(true);

    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause",   onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("error",   onError);
    audio.addEventListener("stalled", onStalled);

    // ── Cross-provider coordination ─────────────────────────────────────────
    // When a project track starts → fade radio out
    const onProjectStarted = () => {
      // Cancel any pending radio-resume debounce
      if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }

      // Clean up any pending fade-in listener (prevents stale fade-in after re-play)
      if (firstPlayRef.current) {
        audio.removeEventListener("playing", firstPlayRef.current);
        firstPlayRef.current = null;
      }

      // Cancel any in-progress fade timer
      if (fadeTimerRef.current) { clearInterval(fadeTimerRef.current); fadeTimerRef.current = null; }

      // Radio is "active" if it's playing OR loading (play() called but not yet buffered)
      // We check both playingRef AND !audio.paused to catch the buffering window
      const radioActive = playingRef.current || (!audio.paused && !!audio.src);
      if (!radioActive) return; // radio truly silent — nothing to do

      wasProjectRef.current = true;

      startFadeOut(audio, 800, fadeTimerRef, () => {
        audio.pause();
        audio.volume = volumeRef.current / 100; // restore target volume for next play
        setLoading(false);
        // setPlaying(false) and playingRef.current = false will be set by onPause event
      });
    };

    // When a project track ends/pauses → maybe fade radio back in
    const onProjectEnded = () => {
      if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }
      if (!wasProjectRef.current) return; // radio wasn't playing before — don't auto-resume

      // Short debounce: if user immediately plays another project track, cancel resume
      resumeTimerRef.current = setTimeout(() => {
        resumeTimerRef.current = null;
        if (!wasProjectRef.current) return;
        wasProjectRef.current = false;

        const ch = RADIO_CHANNELS.find(c => c.id === channelRef.current);
        if (!ch) return;

        // Clean up any stale fade-in listener before adding new one
        if (firstPlayRef.current) {
          audio.removeEventListener("playing", firstPlayRef.current);
          firstPlayRef.current = null;
        }

        // Set src and start playing (volume = 0, will fade in)
        audio.src    = ch.url;
        audio.volume = 0;
        setLoading(true);
        audio.play().catch(() => { setLoading(false); });

        // Fade in once audio starts playing — keep ref so it can be cleaned up
        const onFirstPlay = () => {
          audio.removeEventListener("playing", onFirstPlay);
          firstPlayRef.current = null;
          startFadeIn(audio, 900, volumeRef.current / 100, fadeTimerRef);
        };
        firstPlayRef.current = onFirstPlay;
        audio.addEventListener("playing", onFirstPlay);
      }, 200); // 200 ms debounce — absorbs track-switching
    };

    window.addEventListener("rb:project-started", onProjectStarted);
    window.addEventListener("rb:project-ended",   onProjectEnded);

    return () => {
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause",   onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("error",   onError);
      audio.removeEventListener("stalled", onStalled);
      window.removeEventListener("rb:project-started", onProjectStarted);
      window.removeEventListener("rb:project-ended",   onProjectEnded);
      if (fadeTimerRef.current)   clearInterval(fadeTimerRef.current);
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      audio.pause();
    };
  }, []); // ← empty: create once, never re-run

  // ── Actions ───────────────────────────────────────────────────────────────

  const getUrl = (id: ChannelId) =>
    RADIO_CHANNELS.find((c) => c.id === id)?.url ?? RADIO_CHANNELS[0].url;

  const play = useCallback((channelId?: ChannelId) => {
    const audio = audioRef.current;
    if (!audio) return;

    // Cancel any pending fade / resume timers
    if (fadeTimerRef.current)   { clearInterval(fadeTimerRef.current);   fadeTimerRef.current   = null; }
    if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current);  resumeTimerRef.current = null; }
    if (firstPlayRef.current)   { audio.removeEventListener("playing", firstPlayRef.current); firstPlayRef.current = null; }

    // Clear "was playing before project" — user manually started radio
    wasProjectRef.current = false;

    const id = channelId ?? channelRef.current;
    if (channelId) { channelRef.current = channelId; setChannelState(channelId); }

    // Tell project player to pause (silently — won't trigger rb:project-ended)
    window.dispatchEvent(new Event("rb:radio-started"));

    setLoading(true);
    audio.src    = getUrl(id);
    audio.volume = volumeRef.current / 100;
    audio.play().catch(() => { setLoading(false); setPlaying(false); playingRef.current = false; });
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      const ch = RADIO_CHANNELS.find(c => c.id === id);
      navigator.mediaSession.metadata = new MediaMetadata({
        title:  ch?.label ?? "Jahkno Radio",
        artist: "Redbloods Records",
        album:  "Jahkno Radio",
        artwork: ch?.artwork
          ? [{ src: ch.artwork, sizes: "370x370",
               type: ch.artwork.endsWith(".jpg") ? "image/jpeg" : "image/webp" }]
          : [{ src: "/icon-512.png", sizes: "512x512", type: "image/png" }],
      });
      navigator.mediaSession.setActionHandler("play",  () => audio.play().catch(() => {}));
      navigator.mediaSession.setActionHandler("pause", () => audio.pause());
      navigator.mediaSession.setActionHandler("stop",  () => audio.pause());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pause = useCallback(() => {
    if (fadeTimerRef.current) { clearInterval(fadeTimerRef.current); fadeTimerRef.current = null; }
    audioRef.current?.pause();
    if (typeof navigator !== "undefined" && "mediaSession" in navigator)
      navigator.mediaSession.playbackState = "paused";
  }, []);

  const stop = useCallback(() => {
    if (fadeTimerRef.current)   { clearInterval(fadeTimerRef.current);  fadeTimerRef.current   = null; }
    if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }
    const audio = audioRef.current;
    if (firstPlayRef.current && audio) { audio.removeEventListener("playing", firstPlayRef.current); firstPlayRef.current = null; }
    wasProjectRef.current = false;
    if (!audio) return;
    audio.pause();
    audio.src = "";
    setLoading(false);
  }, []);

  const setChannel = useCallback((id: ChannelId) => {
    channelRef.current = id;
    setChannelState(id);
    if (!playingRef.current) return;
    // Seamlessly switch stream while playing
    const audio = audioRef.current;
    if (!audio) return;
    if (fadeTimerRef.current) { clearInterval(fadeTimerRef.current); fadeTimerRef.current = null; }
    setLoading(true);
    audio.src    = getUrl(id);
    audio.volume = volumeRef.current / 100;
    audio.play().catch(() => { setLoading(false); setPlaying(false); playingRef.current = false; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(100, v));
    volumeRef.current = clamped;           // keep ref in sync
    setVolumeState(clamped);
    if (audioRef.current) audioRef.current.volume = clamped / 100;
  }, []);

  return (
    <RadioContext.Provider
      value={{
        playing, loading, channel, volume, panelOpen,
        play, pause, stop, setChannel, setVolume, setPanelOpen,
      }}
    >
      {children}
    </RadioContext.Provider>
  );
}

"use client";

import { createContext, useContext, useState, useRef, useEffect, useCallback } from "react";

// ── Channels ──────────────────────────────────────────────────────────────────
export const RADIO_CHANNELS = [
  { id: "main",      label: "Jahkno! Main",          url: "https://streaming.radio.co/s00d41a200/listen" },
  { id: "dancehall", label: "Dancehall Reggae",       url: "http://stream.zeno.fm/7qrr5rm9g0hvv" },
  { id: "hiphop",    label: "Hip-Hop × R&B",          url: "http://stream.zeno.fm/4k3px7s9g0hvv" },
  { id: "afrobeats", label: "Afrobeats × Amapiano",   url: "http://stream.zeno.fm/n95vb4dah0hvv" },
  { id: "gospel",    label: "Gospel",                 url: "https://stream.zeno.fm/azvi4fweulauv" },
  { id: "trending",  label: "Trending",               url: "https://stream-163.zeno.fm/ce1jvste7tpuv" },
] as const;

export type ChannelId = (typeof RADIO_CHANNELS)[number]["id"];

// ── Context type ──────────────────────────────────────────────────────────────
interface RadioContextValue {
  playing:    boolean;
  loading:    boolean;
  channel:    ChannelId;
  volume:     number;
  panelOpen:  boolean;
  play:       (channelId?: ChannelId) => void;
  pause:      () => void;
  stop:       () => void;
  setChannel: (id: ChannelId) => void;
  setVolume:  (v: number) => void;
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
  const audioRef      = useRef<HTMLAudioElement | null>(null);
  const channelRef    = useRef<ChannelId>("main");   // shadow for closures
  const playingRef    = useRef(false);               // shadow for closures

  const [playing,   setPlaying]   = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [channel,   setChannelState] = useState<ChannelId>("main");
  const [volume,    setVolumeState]  = useState(80);
  const [panelOpen, setPanelOpen]    = useState(false);

  // Create a single Audio element — only once, at root level
  useEffect(() => {
    const audio = new Audio();
    audio.preload  = "none";
    audio.volume   = 0.8; // default 80 %

    const onPlaying = () => { setPlaying(true);  setLoading(false); playingRef.current = true; };
    const onPause   = () => { setPlaying(false);                    playingRef.current = false; };
    const onWaiting = () =>   setLoading(true);
    const onError   = () => { setPlaying(false); setLoading(false); playingRef.current = false; };
    const onStalled = () =>   setLoading(true);

    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause",   onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("error",   onError);
    audio.addEventListener("stalled", onStalled);

    audioRef.current = audio;

    // Cleanup only happens when the entire app unmounts (browser tab close)
    return () => {
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause",   onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("error",   onError);
      audio.removeEventListener("stalled", onStalled);
      audio.pause();
    };
  }, []); // ← empty dep array: run once, never re-run

  // ── Actions ────────────────────────────────────────────────────────────────

  const getUrl = (id: ChannelId) =>
    RADIO_CHANNELS.find((c) => c.id === id)?.url ?? RADIO_CHANNELS[0].url;

  const play = useCallback((channelId?: ChannelId) => {
    const audio = audioRef.current;
    if (!audio) return;
    const id = channelId ?? channelRef.current;
    if (channelId) {
      channelRef.current = channelId;
      setChannelState(channelId);
    }
    setLoading(true);
    audio.src    = getUrl(id);
    audio.volume = volume / 100;
    audio.play().catch(() => { setLoading(false); setPlaying(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.src = "";
    setPlaying(false);
    setLoading(false);
    playingRef.current = false;
  }, []);

  const setChannel = useCallback((id: ChannelId) => {
    channelRef.current = id;
    setChannelState(id);
    if (!playingRef.current) return;
    // Already playing — seamlessly switch stream
    const audio = audioRef.current;
    if (!audio) return;
    setLoading(true);
    audio.src = getUrl(id);
    audio.play().catch(() => { setLoading(false); setPlaying(false); });
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(100, v));
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

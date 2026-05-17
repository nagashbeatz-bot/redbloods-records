"use client";

import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";

export interface AudioTrack {
  projectId: string;
  projectName: string;
  artist: string;
  fileName: string;
  url: string;
}

interface PlayerContextValue {
  track: AudioTrack | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;          // 0–100
  play: (track: AudioTrack) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  seek: (time: number) => void;
  skip: (seconds: number) => void;
  setVolume: (v: number) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}

export function usePlayerSafe(): PlayerContextValue | null {
  return useContext(PlayerContext);
}

export default function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [track, setTrack] = useState<AudioTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState<number>(() => {
    if (typeof window === "undefined") return 80;
    return Number(localStorage.getItem("player_volume") ?? 80);
  });

  // ── Create audio element once ─────────────────────────────────────────────
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.volume = Number(localStorage.getItem("player_volume") ?? 80) / 100;
    audioRef.current = audio;

    const onTimeUpdate    = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded  = () => setPlaying(false);
    const onPlay   = () => setPlaying(true);
    const onPause  = () => setPlaying(false);

    audio.addEventListener("timeupdate",     onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended",  onEnded);
    audio.addEventListener("play",   onPlay);
    audio.addEventListener("pause",  onPause);

    // ── Cross-provider: when radio starts, silently pause project audio ──────
    // We call audio.pause() directly — NOT through the pause() callback —
    // so we don't dispatch rb:project-ended (that would cause radio to try
    // to resume itself, creating a loop).
    const onRadioStarted = () => {
      audio.pause();
      // Don't dispatch rb:project-ended here — radio is taking over intentionally
    };
    window.addEventListener("rb:radio-started", onRadioStarted);

    return () => {
      audio.removeEventListener("timeupdate",     onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended",  onEnded);
      audio.removeEventListener("play",   onPlay);
      audio.removeEventListener("pause",  onPause);
      window.removeEventListener("rb:radio-started", onRadioStarted);
      audio.pause();
    };
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────

  const play = useCallback((newTrack: AudioTrack) => {
    const audio = audioRef.current;
    if (!audio) return;

    // Notify radio to fade out (if it was playing)
    window.dispatchEvent(new Event("rb:project-started"));

    audio.src = (newTrack.url && newTrack.url !== "#") ? newTrack.url : "";
    audio.load();
    audio.play().catch(() => setPlaying(false));
    setTrack(newTrack);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    // Tell radio it can resume (if it was playing before this project track started)
    window.dispatchEvent(new Event("rb:project-ended"));
  }, []);

  const resume = useCallback(() => {
    // Notify radio to fade out — same as play(), must fire every time user
    // resumes a project track, not just the first time.
    window.dispatchEvent(new Event("rb:project-started"));
    audioRef.current?.play().catch(() => {});
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setTrack(null);
    setPlaying(false);
    // Tell radio it can resume (if it was playing before)
    window.dispatchEvent(new Event("rb:project-ended"));
  }, []);

  const seek = useCallback((time: number) => {
    if (audioRef.current) audioRef.current.currentTime = time;
  }, []);

  const skip = useCallback((seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(
      0,
      Math.min(audioRef.current.currentTime + seconds, audioRef.current.duration || 0)
    );
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(100, v));
    setVolumeState(clamped);
    if (audioRef.current) audioRef.current.volume = clamped / 100;
    localStorage.setItem("player_volume", String(clamped));
  }, []);

  return (
    <PlayerContext.Provider
      value={{ track, playing, currentTime, duration, volume, play, pause, resume, stop, seek, skip, setVolume }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aiff", ".aif"];

export function getLatestAudioFile(
  files: { name: string; url: string; assetId?: number; dropboxPath?: string; dropboxShareUrl?: string }[]
): { name: string; url: string; assetId?: number; dropboxPath?: string; dropboxShareUrl?: string } | null {
  // Only Dropbox files are playable — skip legacy Monday entries (no dropboxPath)
  const audioFiles = files.filter((f) =>
    f.dropboxPath && AUDIO_EXTS.some((ext) => f.name.toLowerCase().endsWith(ext))
  );
  return audioFiles.length > 0 ? audioFiles[audioFiles.length - 1] : null;
}

/**
 * Returns a playable URL for a file.
 * Dropbox files: URL points to /api/dropbox/stream — always fresh.
 * Legacy files without dropboxPath: return stored url as-is.
 */
export async function getFreshPlayUrl(file: { url: string; assetId?: number; dropboxPath?: string }): Promise<string> {
  return file.url;
}

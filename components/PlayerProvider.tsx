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

  // Create audio element once on client
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.volume = volume / 100;
    audioRef.current = audio;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.pause();
    };
  }, []);

  const play = useCallback((newTrack: AudioTrack) => {
    const audio = audioRef.current;
    if (!audio) return;
    // public_url from Monday assets is a pre-signed S3 URL — use directly, no proxy needed
    audio.src = (newTrack.url && newTrack.url !== "#") ? newTrack.url : "";
    audio.load();
    audio.play().catch(() => setPlaying(false));
    setTrack(newTrack);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  const pause = useCallback(() => audioRef.current?.pause(), []);
  const resume = useCallback(() => audioRef.current?.play().catch(() => {}), []);
  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setTrack(null);
    setPlaying(false);
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

// Helper — detect audio files in a project's file list
const AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aiff", ".aif"];
export function getLatestAudioFile(
  files: { name: string; url: string; assetId?: number }[]
): { name: string; url: string; assetId?: number } | null {
  const audioFiles = files.filter((f) =>
    AUDIO_EXTS.some((ext) => f.name.toLowerCase().endsWith(ext))
  );
  return audioFiles.length > 0 ? audioFiles[audioFiles.length - 1] : null;
}

/**
 * Fetch a fresh playable URL for a Monday asset.
 * Monday's public_url is a signed S3 URL that expires after ~1h.
 * This always fetches a fresh one before playback.
 */
export async function getFreshPlayUrl(file: { url: string; assetId?: number }): Promise<string> {
  if (!file.assetId) return file.url;
  try {
    const res = await fetch(`/api/monday/asset-url?assetId=${file.assetId}`);
    if (!res.ok) return file.url;
    const data = await res.json();
    if (!data.url) return file.url;
    // Route through proxy so range-requests work in the browser
    return `/api/monday/file?url=${encodeURIComponent(data.url)}`;
  } catch {
    return file.url;
  }
}

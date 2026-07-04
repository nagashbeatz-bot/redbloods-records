"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useProjects } from "@/components/ProjectsProvider";
import ProjectDrawer from "@/components/ui/ProjectDrawer";
import ProjectDrawerV2 from "@/components/ui/ProjectDrawerV2";
import AlbumCenterModal from "@/components/album/AlbumCenterModal";
import type { Project } from "@/lib/types";

// ── Context ───────────────────────────────────────────────────────────────────

interface GlobalDrawerCtx {
  openProject: (id: string) => void;
  closeProject: () => void;
  drawerProjectId: string | null;
}

const Ctx = createContext<GlobalDrawerCtx | null>(null);

const NOOP: GlobalDrawerCtx = {
  openProject: () => {},
  closeProject: () => {},
  drawerProjectId: null,
};

export function useGlobalProjectDrawer(): GlobalDrawerCtx {
  return useContext(Ctx) ?? NOOP;
}

const ALBUM_TYPES = new Set(["אלבום", "EP"]);

// ── Provider ──────────────────────────────────────────────────────────────────

export default function GlobalProjectDrawerProvider({ children }: { children: React.ReactNode }) {
  const [drawerProjectId, setDrawerProjectId] = useState<string | null>(null);
  const [albumProject,    setAlbumProject]    = useState<Project | null>(null);
  const [useV2,           setUseV2]           = useState(false);
  const { projects } = useProjects();

  // Derive artists list for ArtistCellEdit autocomplete
  const artists = Array.from(new Set(
    projects.flatMap((p) =>
      p.artist.split(/[,،;]/).map((a) => a.trim()).filter(Boolean)
    )
  )).sort((a, b) => a.localeCompare(b, "he"));

  const openProject = useCallback((id: string) => {
    // V2 is the default; use legacy drawer only when ?drawerLegacy=1
    setUseV2(
      typeof window === "undefined" ||
      new URLSearchParams(window.location.search).get("drawerLegacy") !== "1"
    );
    // Look up the project — may not be in context yet if just created
    const found = projects.find((p) => p.id === id);
    if (found && ALBUM_TYPES.has(found.projectType)) {
      setAlbumProject(found);
      setDrawerProjectId(null);
    } else if (!found) {
      // Project not in context yet (e.g. just created, hidden) — fetch then decide
      fetch(`/api/projects/${id}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data: Project | null) => {
          if (!data) return;
          if (ALBUM_TYPES.has(data.projectType)) {
            setAlbumProject(data);
            setDrawerProjectId(null);
          } else {
            setDrawerProjectId(id);
          }
        })
        .catch(() => setDrawerProjectId(id));
    } else {
      setDrawerProjectId(id);
    }
  }, [projects]);

  const closeProject = useCallback(() => {
    setDrawerProjectId(null);
    setAlbumProject(null);
  }, []);

  const router = useRouter();
  const pathname = usePathname();

  // Persist open project/album in URL so Refresh reopens it.
  // Guard: only touch the URL when already on /projects — never redirect from other pages.
  useEffect(() => {
    if (pathname !== "/projects" && !pathname.startsWith("/projects/")) return;
    const id = albumProject?.id ?? drawerProjectId ?? null;
    if (id) {
      router.replace(`/projects?open=${id}`);
    } else {
      router.replace("/projects");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumProject, drawerProjectId, pathname]);

  // Close the project drawer/album when navigating to a supplier page (/team/*) —
  // e.g. after a successful "send" that routes to /team/steven or /team/victor —
  // so the global overlay never stays stuck over the destination page. The URL-sync
  // effect above is guarded to /projects, so it never fights this.
  useEffect(() => {
    if (pathname.startsWith("/team/") && (drawerProjectId || albumProject)) {
      setDrawerProjectId(null);
      setAlbumProject(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Keep albumProject in sync after file uploads (UploadButton calls refresh() → projects updates)
  useEffect(() => {
    if (!albumProject) return;
    const updated = projects.find((p) => p.id === albumProject.id);
    if (updated) setAlbumProject(updated);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  // Broadcast selected project to AppShell so ChatPanel can receive it
  useEffect(() => {
    const id = drawerProjectId ?? albumProject?.id ?? null;
    window.dispatchEvent(
      new CustomEvent("rb:project-selected", { detail: id })
    );
  }, [drawerProjectId, albumProject]);

  return (
    <Ctx.Provider value={{ openProject, closeProject, drawerProjectId }}>
      {children}
      {drawerProjectId && !useV2 && (
        <ProjectDrawer
          projectId={drawerProjectId}
          artists={artists}
          onClose={closeProject}
        />
      )}
      {drawerProjectId && useV2 && (
        <ProjectDrawerV2
          projectId={drawerProjectId}
          artists={artists}
          onClose={closeProject}
        />
      )}
      {albumProject && (
        <AlbumCenterModal project={albumProject} onClose={closeProject} />
      )}
    </Ctx.Provider>
  );
}

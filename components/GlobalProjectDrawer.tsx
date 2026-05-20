"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { useProjects } from "@/components/ProjectsProvider";
import ProjectDrawer from "@/components/ui/ProjectDrawer";

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

// ── Provider ──────────────────────────────────────────────────────────────────

export default function GlobalProjectDrawerProvider({ children }: { children: React.ReactNode }) {
  const [drawerProjectId, setDrawerProjectId] = useState<string | null>(null);
  const { projects } = useProjects();

  // Derive artists list for ArtistCellEdit autocomplete
  const artists = Array.from(new Set(
    projects.flatMap((p) =>
      p.artist.split(/[,،;]/).map((a) => a.trim()).filter(Boolean)
    )
  )).sort((a, b) => a.localeCompare(b, "he"));

  const openProject = useCallback((id: string) => setDrawerProjectId(id), []);
  const closeProject = useCallback(() => setDrawerProjectId(null), []);

  return (
    <Ctx.Provider value={{ openProject, closeProject, drawerProjectId }}>
      {children}
      {drawerProjectId && (
        <ProjectDrawer
          projectId={drawerProjectId}
          artists={artists}
          onClose={closeProject}
        />
      )}
    </Ctx.Provider>
  );
}

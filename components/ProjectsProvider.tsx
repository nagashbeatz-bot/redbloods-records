"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { Project, UpdatableField, PendingCreateAction } from "@/lib/types";
import { isOverdue, isDueSoon } from "@/lib/utils";

interface ProjectsContextValue {
  projects: Project[];
  loading: boolean;
  refresh: () => Promise<void>;
  updateProjectField: (
    id: string,
    field: UpdatableField,
    value: string
  ) => Promise<void>;
  createProject: (fields: PendingCreateAction) => Promise<string>;
  deleteProject: (id: string) => Promise<void>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjects must be used within ProjectsProvider");
  return ctx;
}

export default function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      if (Array.isArray(data)) setProjects(data);
    } catch (err) {
      console.error("Failed to fetch projects:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const updateProjectField = useCallback(
    async (id: string, field: UpdatableField, value: string) => {
      let snapshot: Project[] = [];

      setProjects((prev) => {
        snapshot = prev;
        return prev.map((p) => {
          if (p.id !== id) return p;
          const next = { ...p, [field]: value };
          if (field === "deadline") {
            next.isOverdue = isOverdue(value);
            next.isDueSoon = isDueSoon(value);
          }
          return next as Project;
        });
      });

      let errorMsg: string | null = null;
      try {
        const res = await fetch(`/api/projects/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field, value }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          errorMsg = data.error || "עדכון נכשל";
        }
      } catch {
        errorMsg = "שגיאת חיבור";
      }

      if (errorMsg) {
        setProjects(snapshot);
        throw new Error(errorMsg);
      }
    },
    []
  );

  const deleteProject = useCallback(async (id: string): Promise<void> => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) await fetchAll();
    } catch {
      await fetchAll();
    }
  }, [fetchAll]);

  const createProject = useCallback(async (fields: PendingCreateAction): Promise<string> => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:          fields.name,
        artist:        fields.artist,
        status:        fields.status,
        deadline:      fields.deadline,
        notes:         fields.notes,
        projectType:   fields.projectType,
        parentProject: fields.parentProject,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "יצירה נכשלה");

    await fetchAll();
    return data.id ?? "";
  }, [fetchAll]);

  return (
    <ProjectsContext.Provider value={{ projects, loading, refresh: fetchAll, updateProjectField, createProject, deleteProject }}>
      {children}
    </ProjectsContext.Provider>
  );
}

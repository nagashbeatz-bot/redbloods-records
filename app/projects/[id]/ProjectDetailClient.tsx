"use client";

import { useProjects } from "@/components/ProjectsProvider";
import ProjectDetail from "@/components/project/ProjectDetail";
import { SkeletonCard } from "@/components/ui/Skeleton";
import Link from "next/link";

interface Props {
  id: string;
}

export default function ProjectDetailClient({ id }: Props) {
  const { projects, loading, updateProjectField } = useProjects();

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-4">
        <div style={{ height: 24, width: 160, borderRadius: 6, background: "#1E1E1E" }} />
        <div style={{ height: 40, width: "60%", borderRadius: 8, background: "#1E1E1E" }} />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const project = projects.find((p) => p.id === id);

  if (!project) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16 text-center">
        <div className="text-4xl mb-4" style={{ opacity: 0.3 }}>✕</div>
        <p className="text-base" style={{ color: "#666" }}>פרויקט לא נמצא</p>
        <Link
          href="/projects"
          className="inline-block mt-4 text-sm"
          style={{ color: "#3B82F6" }}
        >
          חזרה לפרויקטים
        </Link>
      </div>
    );
  }

  const handleUpdate = async (
    field: "status" | "deadline" | "notes" | "projectType" | "parentProject",
    value: string
  ) => {
    await updateProjectField(project.id, field, value);
  };

  return <ProjectDetail project={project} onUpdate={handleUpdate} />;
}

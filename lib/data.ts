import type { Project } from "./types";
import { MOCK_PROJECTS } from "./mock-data";

export async function getProjects(): Promise<Project[]> {
  if (!process.env.MONDAY_API_TOKEN) {
    return MOCK_PROJECTS;
  }
  try {
    const { fetchProjects } = await import("./monday");
    return await fetchProjects();
  } catch (err) {
    console.error("Monday fetch failed, falling back to mock:", err);
    return MOCK_PROJECTS;
  }
}

export async function getProject(id: string): Promise<Project | undefined> {
  const projects = await getProjects();
  return projects.find((p) => p.id === id);
}

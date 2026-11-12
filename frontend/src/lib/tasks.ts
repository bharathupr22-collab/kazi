import type { Task } from "@/types";
import { dayKey } from "./dates";
export interface Filters {
  search: string;
  priority: string;
  status: string;
  category: string;
  due: string;
  project: string;
}
export const emptyFilters: Filters = {
  search: "",
  priority: "",
  status: "",
  category: "",
  due: "",
  project: "",
};
export function filterTasks(
  tasks: Task[],
  filters: Filters,
  timezone: string,
  now = new Date(),
) {
  const today = dayKey(now, timezone);
  return tasks.filter((task) => {
    if (
      filters.search &&
      ![task.title, task.description, ...task.tags]
        .join(" ")
        .toLowerCase()
        .includes(filters.search.toLowerCase())
    )
      return false;
    if (filters.priority && task.priority !== filters.priority) return false;
    if (filters.status && task.status !== filters.status) return false;
    if (filters.category && task.category !== filters.category) return false;
    if (filters.project && task.project_id !== filters.project) return false;
    if (filters.due === "none" && task.due_at) return false;
    if (
      filters.due === "today" &&
      (!task.due_at || dayKey(task.due_at, timezone) !== today)
    )
      return false;
    if (
      filters.due === "overdue" &&
      (!task.due_at ||
        new Date(task.due_at) >= now ||
        task.status === "completed")
    )
      return false;
    if (
      filters.due === "week" &&
      (!task.due_at ||
        new Date(task.due_at) < now ||
        new Date(task.due_at).getTime() > now.getTime() + 7 * 86400000)
    )
      return false;
    return true;
  });
}

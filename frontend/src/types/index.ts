export type Status = "todo" | "in_progress" | "completed";
export type Priority = "high" | "medium" | "low";
export interface User {
  id: string;
  name: string;
  email: string;
  timezone: string;
  notifications_enabled: boolean;
}
export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}
export interface TaskInput {
  title: string;
  description: string;
  category: string;
  priority: Priority;
  status: Status;
  start_at: string | null;
  due_at: string | null;
  estimated_minutes: number;
  actual_minutes: number;
  subtasks: Subtask[];
  tags: string[];
  project_id: string | null;
  reminder_minutes: number | null;
}
export interface Task extends TaskInput {
  id: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}
export interface ProjectInput {
  name: string;
  description: string;
  start_at: string | null;
  deadline: string | null;
  status: "active" | "on_hold" | "completed";
  priority: Priority;
}
export interface Project extends ProjectInput {
  id: string;
  task_count: number;
  completed_count: number;
  progress: number;
}
export interface Note {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}
export interface Schedule {
  id: string;
  task_id: string;
  task_title: string;
  start_at: string;
  end_at: string;
}
export interface Notification {
  id: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}
export interface Analytics {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  completion_rate: number;
  total_minutes: number;
  weekly: { date: string; completed: number }[];
  daily?: { hour: string; completed: number }[];
  monthly?: { date: string; completed: number }[];
  projects: { id: string; name: string; progress: number }[];
  insights: string[];
}
export type Action =
  | { type: "create_task"; task: TaskInput }
  | {
      type: "schedule_task";
      task_id: string;
      start_at: string;
      end_at: string;
    };
export interface Proposal {
  id: string;
  summary: string;
  actions: Action[];
  status: string;
}
export interface ChatReply {
  reply: string;
  proposal: Proposal | null;
}

"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, json, message } from "@/lib/api";
import type {
  Analytics,
  Note,
  Notification,
  Project,
  Schedule,
  Task,
  User,
} from "@/types";
import { Spinner } from "@/components/ui/primitives";
interface Data {
  tasks: Task[];
  projects: Project[];
  notes: Note[];
  schedules: Schedule[];
  notifications: Notification[];
  analytics: Analytics | null;
}
interface Workspace extends Data {
  user: User;
  setUser: (user: User) => void;
  refresh: () => Promise<void>;
  mutate: <T = void>(
    path: string,
    method: string,
    body?: unknown,
  ) => Promise<T>;
  refreshing: boolean;
  errors: string[];
}
const Context = createContext<Workspace | null>(null);
const initial: Data = {
  tasks: [],
  projects: [],
  notes: [],
  schedules: [],
  notifications: [],
  analytics: null,
};
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState("");
  const [data, setData] = useState<Data>(initial);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setRefreshing(true);
    const keys = [
      "tasks",
      "projects",
      "notes",
      "schedules",
      "notifications",
      "analytics",
    ] as const;
    const results = await Promise.allSettled(keys.map((key) => api(`/` + key)));
    if (current !== generation.current) return;
    setData((previous) => {
      const next = { ...previous };
      results.forEach((result, i) => {
        if (result.status === "fulfilled")
          Object.assign(next, { [keys[i]]: result.value });
      });
      return next;
    });
    setErrors(
      results.flatMap((result, i) =>
        result.status === "rejected"
          ? [`Could not load ${keys[i]}: ${message(result.reason)}`]
          : [],
      ),
    );
    setLoaded(true);
    setRefreshing(false);
  }, []);
  const authenticate = useCallback(async () => {
    setAuthError("");
    try {
      const current = await api<User>("/auth/me");
      setUser(current);
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401)
        router.replace("/login");
      else setAuthError(message(error));
    }
  }, [refresh, router]);
  useEffect(() => {
    void authenticate();
  }, [authenticate]);
  useEffect(() => {
    if (!user) return;
    const update = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(update, 60000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [user, refresh]);
  const mutate = useCallback(
    async <T,>(path: string, method: string, body?: unknown) => {
      const result = await api<T>(path, json(method, body));
      await refresh();
      return result;
    },
    [refresh],
  );
  if (authError)
    return (
      <div className="boot-error">
        <h1>Let’s reconnect.</h1>
        <p role="alert">{authError}</p>
        <button className="button primary" onClick={authenticate}>
          Try again
        </button>
      </div>
    );
  if (!user || !loaded)
    return (
      <div className="boot">
        <div className="brand">
          kazi<span>✳</span>
        </div>
        <Spinner />
      </div>
    );
  return (
    <Context.Provider
      value={{ ...data, user, setUser, refresh, mutate, refreshing, errors }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkspace() {
  const context = useContext(Context);
  if (!context) throw new Error("WorkspaceProvider missing");
  return context;
}

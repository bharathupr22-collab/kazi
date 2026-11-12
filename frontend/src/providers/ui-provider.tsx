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
import { CheckCircle2, X } from "lucide-react";
import { Modal } from "@/components/ui/primitives";
interface UI {
  theme: string;
  setTheme: (theme: string) => void;
  toast: (text: string) => void;
  confirm: (title: string, description: string) => Promise<boolean>;
}
const Context = createContext<UI | null>(null);
export function UIProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState("light");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<{
    title: string;
    description: string;
  } | null>(null);
  const resolver = useRef<((result: boolean) => void) | null>(null);
  useEffect(() => {
    try {
      updateTheme(
        localStorage.getItem("kazi-theme") ||
          (matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"),
      );
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const setTheme = useCallback((value: string) => {
    updateTheme(value);
    try {
      localStorage.setItem("kazi-theme", value);
    } catch {}
  }, []);
  const toast = useCallback((text: string) => setNotice(text), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const confirm = useCallback(
    (title: string, description: string) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setDialog({ title, description });
      }),
    [],
  );
  function finish(result: boolean) {
    resolver.current?.(result);
    resolver.current = null;
    setDialog(null);
  }
  return (
    <Context.Provider value={{ theme, setTheme, toast, confirm }}>
      {children}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{notice}</span>
          <button
            className="icon-button"
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {dialog && (
        <Modal title={dialog.title} onClose={() => finish(false)}>
          <div className="modal-body">
            <p>{dialog.description}</p>
          </div>
          <div className="modal-footer">
            <button className="button" onClick={() => finish(false)}>
              Cancel
            </button>
            <button className="button primary" onClick={() => finish(true)}>
              Confirm
            </button>
          </div>
        </Modal>
      )}
    </Context.Provider>
  );
}
export function useUI() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("UIProvider missing");
  return ctx;
}

import { WorkspaceProvider } from "@/providers/workspace-provider";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <WorkspaceShell>{children}</WorkspaceShell>
    </WorkspaceProvider>
  );
}

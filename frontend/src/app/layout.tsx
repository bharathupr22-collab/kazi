import type { Metadata } from "next";
import { UIProvider } from "@/providers/ui-provider";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Kazi — Make room for meaningful work",
    template: "%s · Kazi",
  },
  description:
    "A calmer workspace for your tasks, projects, and next big idea.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <UIProvider>{children}</UIProvider>
      </body>
    </html>
  );
}

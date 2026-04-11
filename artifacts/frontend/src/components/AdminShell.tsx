import { type ReactNode } from "react";
import AppShell from "./AppShell";

interface AdminShellProps {
  children: ReactNode;
  onLogout?: () => void;
  userName?: string;
}

export default function AdminShell({ children }: AdminShellProps) {
  return <AppShell>{children}</AppShell>;
}

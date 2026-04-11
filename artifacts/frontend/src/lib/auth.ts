const STORAGE_KEY = "prea_session";

export type Role = "admin" | "user";

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Session {
  token: string;
  user: UserInfo;
  expiresIn: number;
  expiresAt: number;
}

export function saveSession(token: string, user: UserInfo, expiresIn: number): void {
  const expiresAt = Date.now() + expiresIn * 1000;
  const session: Session = { token, user, expiresIn, expiresAt };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session: Session = JSON.parse(raw);
    if (!session.token || !session.user || !session.expiresAt) return null;
    return session;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  const session = getSession();
  if (!session) return false;
  return Date.now() < session.expiresAt;
}

export function isAdmin(): boolean {
  const session = getSession();
  if (!session || Date.now() >= session.expiresAt) return false;
  return session.user.role === "admin";
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

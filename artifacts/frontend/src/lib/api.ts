const BASE_URL = import.meta.env.VITE_API_URL || "/api";

export interface ApiError {
  message: string;
  status: number;
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!response.ok) {
    let message = "Erro inesperado. Tente novamente.";
    try {
      const data = await response.json();
      if (data?.message) message = data.message;
    } catch { /* ignore */ }
    throw { message, status: response.status } as ApiError;
  }

  if (response.status === 204) return undefined as unknown as T;
  return response.json() as Promise<T>;
}

// ── Auth ────────────────────────────────────────────────────
export interface LoginResult {
  token: string;
  user: { id: string; email: string; name: string; role: "admin" | "user" };
  expiresIn: number;
}
export async function loginRequest(p: { email: string; password: string }) {
  return request<LoginResult>("/login", { method: "POST", body: JSON.stringify(p) });
}

export async function registerRequest(p: { name: string; email: string; password: string }) {
  return request<{ user: { id: string; name: string; email: string; role: string; createdAt: string } }>(
    "/register", { method: "POST", body: JSON.stringify(p) }
  );
}

// ── Users (self) ─────────────────────────────────────────────
export interface UserListItem {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
export async function listUsersRequest(token: string) {
  return request<{ users: UserListItem[] }>("/users", {}, token);
}

// ── Admin: Users ─────────────────────────────────────────────
export async function adminListUsers(token: string) {
  return request<{ users: UserListItem[] }>("/admin/users", {}, token);
}

export async function adminCreateUser(
  token: string,
  p: { name: string; email: string; password: string; role: "admin" | "user" },
) {
  return request<{ user: UserListItem }>("/admin/users", {
    method: "POST",
    body: JSON.stringify(p),
  }, token);
}

export async function adminUpdateUserName(token: string, id: string, name: string) {
  return request<{ user: UserListItem }>(`/admin/users/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  }, token);
}

export async function adminChangeRole(token: string, id: string, role: "admin" | "user") {
  return request<{ user: UserListItem }>(`/admin/users/${id}/role`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  }, token);
}

export async function adminChangeStatus(token: string, id: string, active: boolean) {
  return request<{ user: UserListItem }>(`/admin/users/${id}/status`, {
    method: "PUT",
    body: JSON.stringify({ active }),
  }, token);
}

export async function adminDeleteUser(token: string, id: string) {
  return request<void>(`/admin/users/${id}`, { method: "DELETE" }, token);
}

// ── Admin: Evolution Config per user ─────────────────────────
export interface EvolutionConfigPublic {
  url: string;
  instanceName: string;
  hasApiKey: boolean;
  updatedAt: string;
}

export async function adminGetUserEvolutionConfig(token: string, userId: string) {
  return request<{ userId: string; config: EvolutionConfigPublic | null }>(
    `/admin/users/${userId}/evolution-config`, {}, token
  );
}

export async function adminUpdateUserEvolutionConfig(
  token: string,
  userId: string,
  p: { url: string; apiKey?: string; instanceName: string },
) {
  return request<{ userId: string; config: EvolutionConfigPublic }>(
    `/admin/users/${userId}/evolution-config`,
    { method: "PUT", body: JSON.stringify(p) },
    token,
  );
}

// ── Self: Evolution Config ────────────────────────────────────
export async function getEvolutionConfig(token: string) {
  return request<{ config: EvolutionConfigPublic | null }>("/evolution-config", {}, token);
}

export async function saveEvolutionConfig(
  token: string,
  p: { url: string; apiKey: string },
) {
  return request<{ config: EvolutionConfigPublic }>("/evolution-config", {
    method: "POST",
    body: JSON.stringify(p),
  }, token);
}

export async function testEvolutionConfig(token: string) {
  return request<{ ok: boolean; message: string }>("/evolution-config/test", {
    method: "POST",
  }, token);
}

// ── Instances ─────────────────────────────────────────────────
export interface WhatsAppInstance {
  instance?: {
    instanceName?: string;
    name?: string;
    status?: string;
    connectionStatus?: string;
    state?: string;
    [key: string]: unknown;
  };
  instanceName?: string;
  name?: string;
  status?: string;
  connectionStatus?: string;
  [key: string]: unknown;
}

export async function listInstances(token: string) {
  return request<{ instances: WhatsAppInstance[] }>("/instances", {}, token);
}

export async function createInstance(token: string, p: { instanceName: string }) {
  return request<unknown>("/instances", { method: "POST", body: JSON.stringify(p) }, token);
}

export interface InstanceStatusResponse {
  instance?: { state?: string; status?: string; [key: string]: unknown };
  state?: string;
  [key: string]: unknown;
}

export async function getInstanceStatus(token: string, instanceName: string) {
  return request<InstanceStatusResponse>(`/instances/${instanceName}/status`, {}, token);
}

export interface QRCodeResponse {
  instance?: { pairingCode?: string | null; code?: string; base64?: string; [key: string]: unknown };
  base64?: string;
  code?: string;
  pairingCode?: string | null;
  [key: string]: unknown;
}

export async function getInstanceQRCode(token: string, instanceName: string) {
  return request<QRCodeResponse>(`/instances/${instanceName}/qrcode`, {}, token);
}

export async function restartInstance(token: string, instanceName: string) {
  return request<{ ok: boolean; message: string }>(`/instances/${instanceName}/restart`, { method: "PUT" }, token);
}

export async function logoutInstance(token: string, instanceName: string) {
  return request<{ ok: boolean; message: string }>(`/instances/${instanceName}/logout`, { method: "DELETE" }, token);
}

export async function deleteInstance(token: string, instanceName: string) {
  return request<{ ok: boolean; message: string }>(`/instances/${instanceName}`, { method: "DELETE" }, token);
}

// ── Contacts ────────────────────────────────────────────────────
export interface Contact {
  id?: string;
  remoteJid?: string;
  pushName?: string;
  profilePictureUrl?: string;
  name?: string;
  phone?: string;
  [key: string]: unknown;
}

export interface Chat {
  id?: string;
  remoteJid?: string;
  name?: string;
  pushName?: string;
  profilePictureUrl?: string;
  unreadCount?: number;
  lastMessage?: {
    message?: { conversation?: string; [key: string]: unknown };
    messageTimestamp?: number;
    [key: string]: unknown;
  };
  updatedAt?: string;
  [key: string]: unknown;
}

export interface Message {
  key?: { id?: string; remoteJid?: string; fromMe?: boolean; [key: string]: unknown };
  message?: { conversation?: string; extendedTextMessage?: { text?: string }; [key: string]: unknown };
  messageTimestamp?: number;
  status?: string;
  [key: string]: unknown;
}

export async function fetchContacts(token: string, page = 1, limit = 100) {
  return request<{ contacts: Contact[]; total: number }>(
    `/contacts?page=${page}&limit=${limit}`, {}, token
  );
}

export async function searchContacts(token: string, q: string) {
  return request<{ contacts: Contact[] }>(
    `/contacts/search?q=${encodeURIComponent(q)}`, {}, token
  );
}

export async function fetchChats(token: string) {
  return request<{ chats: Chat[] }>("/chats", {}, token);
}

export async function fetchMessages(token: string, chatId: string, limit = 50) {
  return request<{ messages: Message[] }>(
    `/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`, {}, token
  );
}

export async function sendTextMessage(token: string, chatId: string, text: string) {
  return request<{ key?: { id: string } }>(
    "/messages/send",
    { method: "POST", body: JSON.stringify({ chatId, text }) },
    token,
  );
}

export async function sendToNumber(token: string, number: string, text: string) {
  return request<unknown>("/messages/send-to-number", {
    method: "POST",
    body: JSON.stringify({ number, text }),
  }, token);
}

export interface BulkResult {
  sent: number;
  failed: number;
  results: { number: string; ok: boolean; error?: string }[];
}
export async function sendBulkMessages(token: string, numbers: string[], text: string) {
  return request<BulkResult>("/messages/send-bulk", {
    method: "POST",
    body: JSON.stringify({ numbers, text }),
  }, token);
}

export async function sendMediaMessage(
  token: string,
  chatId: string,
  mediatype: "image" | "video" | "document",
  base64: string,
  mimetype: string,
  fileName: string,
  caption = "",
) {
  return request<{ key?: { id: string } }>(
    "/messages/send-media",
    { method: "POST", body: JSON.stringify({ chatId, mediatype, base64, mimetype, fileName, caption }) },
    token,
  );
}

// ── Admin: Audit ───────────────────────────────────────────────
export interface AuditEntry {
  id: string;
  timestamp: string;
  adminId: string;
  adminEmail: string;
  action: string;
  targetId: string;
  targetEmail?: string;
  detail: string;
}

export async function getAuditLog(token: string, limit = 100) {
  return request<{ entries: AuditEntry[]; total: number }>(
    `/admin/audit?limit=${limit}`, {}, token
  );
}

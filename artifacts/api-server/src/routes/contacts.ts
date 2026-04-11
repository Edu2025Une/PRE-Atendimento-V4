import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth-middleware";
import { getConfig } from "../store/evolution-config";

const router: IRouter = Router();
router.use(requireAuth);

async function getUserCfg(userId: string, res: { status: (c: number) => { json: (v: unknown) => void } }) {
  const cfg = await getConfig(userId);
  if (!cfg) {
    res.status(400).json({ message: "Configure sua Evolution API antes de continuar." });
    return null;
  }
  if (!cfg.apiKey) {
    res.status(400).json({ message: "API Key não configurada." });
    return null;
  }
  return cfg;
}

async function evoFetch(
  url: string,
  apiKey: string,
  method: string = "GET",
  body?: unknown,
  timeoutMs = 20000,
): Promise<{ ok: boolean; status: number; data: unknown; rawText: string }> {
  const headers: Record<string, string> = { apikey: apiKey };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const rawText = await response.text();
  let data: unknown = rawText;
  try { data = JSON.parse(rawText); } catch { /* keep as string */ }

  return { ok: response.ok, status: response.status, data, rawText };
}

function extractEvoError(data: unknown, status: number): string {
  if (typeof data === "object" && data !== null) {
    const d = data as Record<string, unknown>;
    const msg = d["message"] ?? d["error"] ?? d["detail"] ?? d["msg"];
    if (msg) return String(msg);
  }
  if (typeof data === "string" && data.length < 300) return data;
  return `Erro ${status} da Evolution API.`;
}

function extractContacts(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && data !== null) {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d["contacts"])) return d["contacts"] as unknown[];
    if (Array.isArray(d["data"])) return d["data"] as unknown[];
  }
  return [];
}

function extractChats(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && data !== null) {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d["chats"])) return d["chats"] as unknown[];
    if (Array.isArray(d["data"])) return d["data"] as unknown[];
  }
  return [];
}

function extractMessages(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && data !== null) {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d["messages"])) return d["messages"] as unknown[];
    const msgs = d["messages"] as Record<string, unknown> | undefined;
    if (msgs && Array.isArray(msgs["records"])) return msgs["records"] as unknown[];
    if (Array.isArray(d["data"])) return d["data"] as unknown[];
    if (Array.isArray(d["records"])) return d["records"] as unknown[];
  }
  return [];
}

// ── List contacts — tries variants in order ──────────
router.get("/contacts", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const limit = Math.min(Number(req.query["limit"] ?? 200), 500);

  // Try variants in order until one works
  // v2.3.x (Evolution API 2.3+) uses /chat/findContacts
  const variants: Array<{ url: string; method: string; body?: unknown }> = [
    // v2.3+ — contacts live under the chat module
    { url: `${cfg.url}/chat/findContacts/${cfg.instanceName}`, method: "POST", body: { where: {} } },
    // v2 classic POST
    { url: `${cfg.url}/contact/fetchContacts/${cfg.instanceName}`, method: "POST", body: { where: {}, limit } },
    // v2 findContacts variant
    { url: `${cfg.url}/contact/findContacts/${cfg.instanceName}`, method: "POST", body: { where: {} } },
    // v2 GET with pagination
    { url: `${cfg.url}/contacts/fetchContacts/${cfg.instanceName}?page=1&offset=${limit}`, method: "GET" },
    // v1 style
    { url: `${cfg.url}/contact/fetchContacts/${cfg.instanceName}`, method: "GET" },
  ];

  try {
    for (const variant of variants) {
      const { ok, status, data } = await evoFetch(variant.url, cfg.apiKey, variant.method, variant.body);
      if (ok) {
        let contacts = extractContacts(data);
        // Apply limit on server side since some API versions ignore it
        if (contacts.length > limit) contacts = contacts.slice(0, limit);
        res.json({ contacts, total: contacts.length });
        return;
      }
      // If 404/405, try next variant. If other 4xx/5xx, return error
      if (status !== 404 && status !== 405) {
        res.status(502).json({ message: extractEvoError(data, status) });
        return;
      }
    }
    res.status(502).json({ message: "Endpoint de contatos não encontrado nesta versão da Evolution API." });
  } catch (err) {
    req.log.error({ err }, "Erro ao buscar contatos");
    res.status(502).json({ message: "Não foi possível conectar à Evolution API." });
  }
});

// ── Search contacts ───────────────────────────────────────
router.get("/contacts/search", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const q = String(req.query["q"] ?? "").trim().toLowerCase();
  if (!q) { res.json({ contacts: [] }); return; }

  // v2.3.x does not support text search in where clause; fetch all and filter locally
  const variants: Array<{ url: string; method: string; body?: unknown }> = [
    { url: `${cfg.url}/chat/findContacts/${cfg.instanceName}`, method: "POST", body: { where: {} } },
    { url: `${cfg.url}/contact/fetchContacts/${cfg.instanceName}`, method: "POST", body: { where: {} } },
    { url: `${cfg.url}/contact/findContacts/${cfg.instanceName}`, method: "POST", body: { where: {} } },
    { url: `${cfg.url}/contact/fetchContacts/${cfg.instanceName}`, method: "GET" },
  ];

  try {
    for (const variant of variants) {
      const { ok, status, data } = await evoFetch(variant.url, cfg.apiKey, variant.method, variant.body);
      if (ok) {
        const all = extractContacts(data);
        // Filter locally by pushName or remoteJid (phone number)
        const filtered = all.filter((c) => {
          const contact = c as Record<string, unknown>;
          const name = String(contact["pushName"] ?? "").toLowerCase();
          const jid = String(contact["remoteJid"] ?? "").toLowerCase();
          const phone = jid.replace(/@.*/, "");
          return name.includes(q) || phone.includes(q);
        });
        res.json({ contacts: filtered.slice(0, 100) });
        return;
      }
      if (status !== 404 && status !== 405) {
        res.status(502).json({ message: extractEvoError(data, status) });
        return;
      }
    }
    res.json({ contacts: [] });
  } catch (err) {
    req.log.error({ err }, "Erro ao pesquisar contatos");
    res.status(502).json({ message: "Falha ao pesquisar contatos." });
  }
});

// ── List chats ────────────────────────────────────────────
router.get("/chats", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const variants: Array<{ url: string; method: string; body?: unknown }> = [
    { url: `${cfg.url}/chat/findChats/${cfg.instanceName}`, method: "POST", body: { where: {} } },
    { url: `${cfg.url}/chat/findChats/${cfg.instanceName}`, method: "GET" },
    { url: `${cfg.url}/chats/findChats/${cfg.instanceName}`, method: "GET" },
  ];

  try {
    for (const variant of variants) {
      const { ok, status, data } = await evoFetch(variant.url, cfg.apiKey, variant.method, variant.body);
      if (ok) {
        res.json({ chats: extractChats(data) });
        return;
      }
      if (status !== 404 && status !== 405) {
        res.status(502).json({ message: extractEvoError(data, status) });
        return;
      }
    }
    res.status(502).json({ message: "Endpoint de chats não encontrado nesta versão da Evolution API." });
  } catch (err) {
    req.log.error({ err }, "Erro ao buscar chats");
    res.status(502).json({ message: "Não foi possível conectar à Evolution API." });
  }
});

// ── Get messages for a chat ───────────────────────────────
router.get("/chats/:chatId/messages", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const { chatId } = req.params;
  const limit = Math.min(Number(req.query["limit"] ?? 50), 200);

  const variants: Array<{ url: string; method: string; body?: unknown }> = [
    // POST with body (most common in v2+)
    {
      url: `${cfg.url}/chat/findMessages/${cfg.instanceName}`,
      method: "POST",
      body: { where: { key: { remoteJid: chatId } }, limit },
    },
    // GET with query params
    {
      url: `${cfg.url}/chat/findMessages/${cfg.instanceName}?where[key][remoteJid]=${encodeURIComponent(chatId)}&limit=${limit}`,
      method: "GET",
    },
    // Alternative path
    {
      url: `${cfg.url}/message/findMessages/${cfg.instanceName}`,
      method: "POST",
      body: { where: { key: { remoteJid: chatId } }, limit },
    },
  ];

  try {
    for (const variant of variants) {
      const { ok, status, data } = await evoFetch(variant.url, cfg.apiKey, variant.method, variant.body);
      if (ok) {
        res.json({ messages: extractMessages(data) });
        return;
      }
      if (status !== 404 && status !== 405) {
        res.status(502).json({ message: extractEvoError(data, status) });
        return;
      }
    }
    res.status(502).json({ message: "Endpoint de mensagens não encontrado." });
  } catch (err) {
    req.log.error({ err }, "Erro ao buscar mensagens");
    res.status(502).json({ message: "Falha ao buscar mensagens." });
  }
});

// ── Send text message ─────────────────────────────────────
router.post("/messages/send", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const { chatId, text } = req.body as { chatId?: string; text?: string };
  if (!chatId?.trim() || !text?.trim()) {
    res.status(400).json({ message: "chatId e text são obrigatórios." });
    return;
  }

  const number = chatId.replace(/@.*$/, "");

  const { ok, status, data } = await evoFetch(
    `${cfg.url}/message/sendText/${cfg.instanceName}`,
    cfg.apiKey,
    "POST",
    { number, text: text.trim() },
  );

  if (ok) {
    res.json(data);
  } else {
    res.status(502).json({ message: extractEvoError(data, status) });
  }
});

// ── Send media message ────────────────────────────────────
router.post("/messages/send-media", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const { chatId, mediatype, base64, mimetype, fileName, caption } = req.body as {
    chatId?: string;
    mediatype?: string;
    base64?: string;
    mimetype?: string;
    fileName?: string;
    caption?: string;
  };

  if (!chatId?.trim() || !mediatype || !base64) {
    res.status(400).json({ message: "chatId, mediatype e base64 são obrigatórios." });
    return;
  }

  const number = chatId.replace(/@.*$/, "");

  const { ok, status, data } = await evoFetch(
    `${cfg.url}/message/sendMedia/${cfg.instanceName}`,
    cfg.apiKey,
    "POST",
    {
      number,
      mediatype,
      media: base64,
      mimetype: mimetype ?? "application/octet-stream",
      fileName: fileName ?? "arquivo",
      caption: caption ?? "",
    },
  );

  if (ok) {
    res.json(data);
  } else {
    res.status(502).json({ message: extractEvoError(data, status) });
  }
});

export default router;

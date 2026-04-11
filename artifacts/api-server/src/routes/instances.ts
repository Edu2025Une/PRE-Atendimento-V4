import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth-middleware";
import { getConfig } from "../store/evolution-config";

const router: IRouter = Router();
router.use(requireAuth);

async function getUserCfg(userId: string, res: { status: (c: number) => { json: (v: unknown) => void } }) {
  const cfg = await getConfig(userId);
  if (!cfg) {
    res.status(400).json({ message: "Configure sua Evolution API antes de usar instâncias." });
    return null;
  }
  if (!cfg.apiKey) {
    res.status(400).json({ message: "API Key não configurada. Salve a configuração primeiro." });
    return null;
  }
  return cfg;
}

async function evoProxy(
  url: string,
  apiKey: string,
  method: string = "GET",
  body?: unknown,
  timeoutMs = 15000,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const headers: Record<string, string> = { apikey: apiKey };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  return { ok: response.ok, status: response.status, data };
}

// ── Get user's own instance ───────────────────────────────────
// Returns ONLY the user's bound instance (never the global list).
// instanceName is always resolved from DB via user_id.
router.get("/instances", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  try {
    const { ok, data } = await evoProxy(
      `${cfg.url}/instance/connectionState/${cfg.instanceName}`,
      cfg.apiKey,
      "GET",
      undefined,
      10000,
    );
    if (!ok) {
      res.json({ instances: [] });
      return;
    }
    const d = data as Record<string, unknown>;
    const inst = d.instance as Record<string, unknown> | undefined;
    const state = (inst?.state ?? inst?.status ?? d.state ?? "unknown") as string;
    res.json({
      instances: [{ instance: { instanceName: cfg.instanceName, state, connectionStatus: state } }],
    });
  } catch {
    res.json({ instances: [] });
  }
});

// ── Create user's instance ────────────────────────────────────
// instanceName is ALWAYS taken from DB (user's saved config).
// Any instanceName sent in the request body is ignored.
router.post("/instances", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const instanceName = cfg.instanceName;
  const integration = (req.body as { integration?: string }).integration ?? "WHATSAPP-BAILEYS";

  try {
    const { ok, data } = await evoProxy(
      `${cfg.url}/instance/create`,
      cfg.apiKey,
      "POST",
      { instanceName, integration },
      15000,
    );
    res.status(ok ? 201 : 502).json(data);
  } catch (err) {
    req.log.error({ err }, "Erro ao criar instância");
    res.status(502).json({ message: "Não foi possível criar a instância." });
  }
});

// ── Get instance connection status ────────────────────────────
// URL param is present only for routing compatibility.
// instanceName is ALWAYS resolved from DB via user_id.
router.get("/instances/:any/status", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const instanceName = cfg.instanceName;
  try {
    const { ok, status, data } = await evoProxy(
      `${cfg.url}/instance/connectionState/${instanceName}`,
      cfg.apiKey,
      "GET",
      undefined,
      8000,
    );
    if (!ok) { res.status(502).json(typeof data === "object" ? data : { message: `Erro ${status}.` }); return; }
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Erro ao obter status da instância");
    res.status(502).json({ message: "Falha ao obter status da instância." });
  }
});

// ── Get QR Code (connect) ─────────────────────────────────────
// instanceName is ALWAYS resolved from DB via user_id.
router.get("/instances/:any/qrcode", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const instanceName = cfg.instanceName;
  try {
    const { ok, status, data } = await evoProxy(
      `${cfg.url}/instance/connect/${instanceName}`,
      cfg.apiKey,
      "GET",
      undefined,
      30000,
    );
    if (!ok) { res.status(502).json(typeof data === "object" ? data : { message: `Erro ${status}.` }); return; }

    const d = data as Record<string, unknown>;
    if (!d.base64 && d.count !== undefined) {
      res.status(409).json({
        message: "A instância já está conectada ou possui sessão salva. Desconecte-a primeiro para gerar um novo QR Code.",
        alreadyConnected: true,
      });
      return;
    }

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Erro ao obter QR Code");
    res.status(502).json({ message: "Falha ao gerar QR Code. Verifique se a instância existe e foi criada." });
  }
});

// ── Logout / disconnect instance ──────────────────────────────
// Must be declared BEFORE the bare delete route to take precedence.
// instanceName is ALWAYS resolved from DB via user_id.
router.delete("/instances/:any/logout", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const instanceName = cfg.instanceName;
  try {
    const { ok, status, data } = await evoProxy(
      `${cfg.url}/instance/logout/${instanceName}`,
      cfg.apiKey,
      "DELETE",
      undefined,
      15000,
    );
    if (!ok) { res.status(502).json(typeof data === "object" ? data : { message: `Erro ${status}.` }); return; }
    res.json({ ok: true, message: "WhatsApp desconectado com sucesso." });
  } catch (err) {
    req.log.error({ err }, "Erro ao desconectar instância");
    res.status(502).json({ message: "Falha ao desconectar a instância." });
  }
});

// ── Restart instance ──────────────────────────────────────────
// instanceName is ALWAYS resolved from DB via user_id.
router.put("/instances/:any/restart", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const instanceName = cfg.instanceName;
  try {
    const { ok, status, data } = await evoProxy(
      `${cfg.url}/instance/restart/${instanceName}`,
      cfg.apiKey,
      "POST",
      {},
      15000,
    );
    if (!ok) { res.status(502).json(typeof data === "object" ? data : { message: `Erro ${status}.` }); return; }
    res.json({ ok: true, message: "Instância reiniciada.", data });
  } catch (err) {
    req.log.error({ err }, "Erro ao reiniciar instância");
    res.status(502).json({ message: "Falha ao reiniciar a instância." });
  }
});

// ── Delete instance completely ────────────────────────────────
// instanceName is ALWAYS resolved from DB via user_id.
router.delete("/instances/:any", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const instanceName = cfg.instanceName;
  try {
    const { ok, status, data } = await evoProxy(
      `${cfg.url}/instance/delete/${instanceName}`,
      cfg.apiKey,
      "DELETE",
      undefined,
      15000,
    );
    if (!ok) { res.status(502).json(typeof data === "object" ? data : { message: `Erro ${status}.` }); return; }
    res.json({ ok: true, message: "Instância apagada com sucesso." });
  } catch (err) {
    req.log.error({ err }, "Erro ao apagar instância");
    res.status(502).json({ message: "Falha ao apagar a instância." });
  }
});

export default router;

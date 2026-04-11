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

function extractEvoMessage(data: unknown, httpStatus: number): string {
  if (typeof data === "string" && data.trim()) return data.trim().slice(0, 300);
  if (typeof data === "object" && data !== null) {
    const d = data as Record<string, unknown>;
    const msg =
      (d.message as string) ??
      (d.error as string) ??
      (d.msg as string) ??
      ((d.response as Record<string, unknown>)?.message as string) ??
      ((d.response as Record<string, unknown>)?.error as string) ??
      null;
    if (msg) return String(msg).slice(0, 300);
  }
  if (httpStatus === 401) return "API Key inválida ou sem permissão. Verifique a chave configurada.";
  if (httpStatus === 403) return "Acesso negado pela Evolution API. Verifique a API Key.";
  if (httpStatus === 404) return "Instância não encontrada na Evolution API. Crie a instância primeiro.";
  if (httpStatus === 409) return "Já existe um recurso com este nome na Evolution API.";
  return `Erro ${httpStatus} na Evolution API.`;
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
router.post("/instances", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const instanceName = cfg.instanceName;
  const integration = (req.body as { integration?: string }).integration ?? "WHATSAPP-BAILEYS";

  try {
    const { ok, status, data } = await evoProxy(
      `${cfg.url}/instance/create`,
      cfg.apiKey,
      "POST",
      { instanceName, integration },
      15000,
    );
    if (!ok) {
      const message = extractEvoMessage(data, status);
      res.status(502).json({ message, evoStatus: status, evoData: data });
      return;
    }
    res.status(201).json(data);
  } catch (err: unknown) {
    req.log.error({ err }, "Erro ao criar instância");
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    const isTimeout = msg.includes("timeout") || msg.includes("Timeout");
    res.status(502).json({
      message: isTimeout
        ? "Tempo esgotado ao tentar criar a instância. Verifique se a URL da Evolution API está correta e acessível."
        : `Não foi possível criar a instância: ${msg}`,
    });
  }
});

// ── Get instance connection status ────────────────────────────
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
    if (!ok) {
      const message = extractEvoMessage(data, status);
      res.status(502).json({ message, evoStatus: status });
      return;
    }
    res.json(data);
  } catch (err: unknown) {
    req.log.error({ err }, "Erro ao obter status da instância");
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    const isTimeout = msg.includes("timeout") || msg.includes("Timeout");
    res.status(502).json({
      message: isTimeout
        ? "Tempo esgotado. Verifique se a URL da Evolution API está correta e acessível."
        : `Falha ao obter status da instância: ${msg}`,
    });
  }
});

// ── Get QR Code (connect) ─────────────────────────────────────
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
    if (!ok) {
      const message = extractEvoMessage(data, status);
      res.status(502).json({ message, evoStatus: status, evoData: data });
      return;
    }

    const d = data as Record<string, unknown>;
    if (!d.base64 && d.count !== undefined) {
      res.status(409).json({
        message: "A instância já está conectada ou possui sessão salva. Desconecte-a primeiro para gerar um novo QR Code.",
        alreadyConnected: true,
      });
      return;
    }

    if (!d.base64) {
      const inst = d.instance as Record<string, unknown> | undefined;
      if (!inst?.base64) {
        res.status(502).json({
          message: "QR Code não retornado pela Evolution API. A instância pode já estar conectada ou foi criada há pouco.",
        });
        return;
      }
    }

    res.json(data);
  } catch (err: unknown) {
    req.log.error({ err }, "Erro ao obter QR Code");
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    const isTimeout = msg.includes("timeout") || msg.includes("Timeout");
    res.status(502).json({
      message: isTimeout
        ? "Tempo esgotado ao gerar QR Code. Verifique se a URL da Evolution API está acessível."
        : `Falha ao gerar QR Code: ${msg}`,
    });
  }
});

// ── Logout / disconnect instance ──────────────────────────────
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
    if (!ok) {
      const message = extractEvoMessage(data, status);
      res.status(502).json({ message, evoStatus: status });
      return;
    }
    res.json({ ok: true, message: "WhatsApp desconectado com sucesso." });
  } catch (err: unknown) {
    req.log.error({ err }, "Erro ao desconectar instância");
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    res.status(502).json({ message: `Falha ao desconectar a instância: ${msg}` });
  }
});

// ── Restart instance ──────────────────────────────────────────
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
    if (!ok) {
      const message = extractEvoMessage(data, status);
      res.status(502).json({ message, evoStatus: status });
      return;
    }
    res.json({ ok: true, message: "Instância reiniciada.", data });
  } catch (err: unknown) {
    req.log.error({ err }, "Erro ao reiniciar instância");
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    res.status(502).json({ message: `Falha ao reiniciar a instância: ${msg}` });
  }
});

// ── Delete instance completely ────────────────────────────────
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
    if (!ok) {
      const message = extractEvoMessage(data, status);
      res.status(502).json({ message, evoStatus: status });
      return;
    }
    res.json({ ok: true, message: "Instância apagada com sucesso." });
  } catch (err: unknown) {
    req.log.error({ err }, "Erro ao apagar instância");
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    res.status(502).json({ message: `Falha ao apagar a instância: ${msg}` });
  }
});

export default router;

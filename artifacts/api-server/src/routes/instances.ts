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

const GENERIC_HTTP_STRINGS = new Set([
  "not found", "notfound", "unauthorized", "forbidden",
  "bad request", "internal server error", "bad gateway",
  "service unavailable", "gateway timeout",
]);

function extractEvoMessage(data: unknown, httpStatus: number): string {
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (trimmed && !GENERIC_HTTP_STRINGS.has(trimmed.toLowerCase())) {
      return trimmed.slice(0, 300);
    }
  }
  if (typeof data === "object" && data !== null) {
    const d = data as Record<string, unknown>;
    const raw =
      (d.message as string) ??
      (d.error as string) ??
      (d.msg as string) ??
      ((d.response as Record<string, unknown>)?.message as string) ??
      ((d.response as Record<string, unknown>)?.error as string) ??
      null;
    if (raw && !GENERIC_HTTP_STRINGS.has(String(raw).toLowerCase())) {
      return String(raw).slice(0, 300);
    }
  }
  if (httpStatus === 401) return "API Key inválida ou sem permissão. Verifique a chave configurada.";
  if (httpStatus === 403) return "Acesso negado pela Evolution API. Verifique a API Key.";
  if (httpStatus === 404) return "Instância não encontrada na Evolution API. Ela pode não existir ou já ter sido apagada.";
  if (httpStatus === 409) return "Já existe um recurso com este nome na Evolution API.";
  return `Erro ${httpStatus} retornado pela Evolution API.`;
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

// ── List ALL instances from Evolution API ─────────────────────
router.get("/instances", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  try {
    const { ok, status, data } = await evoProxy(
      `${cfg.url}/instance/fetchInstances`,
      cfg.apiKey,
      "GET",
      undefined,
      12000,
    );
    if (!ok) {
      const message = extractEvoMessage(data, status);
      res.status(502).json({ message, instances: [] });
      return;
    }
    // Evolution API returns an array directly
    const instances = Array.isArray(data) ? data : [];
    res.json({ instances });
  } catch (err: unknown) {
    req.log.error({ err }, "Erro ao listar instâncias");
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    const isTimeout = msg.includes("timeout") || msg.includes("Timeout");
    res.status(502).json({
      message: isTimeout
        ? "Tempo esgotado. Verifique se a URL da Evolution API está acessível."
        : `Falha ao listar instâncias: ${msg}`,
      instances: [],
    });
  }
});

// ── Create a new instance ─────────────────────────────────────
router.post("/instances", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const body = req.body as { instanceName?: string; integration?: string };
  const instanceName = body.instanceName?.trim() || cfg.instanceName;
  const integration = body.integration ?? "WHATSAPP-BAILEYS";

  if (!instanceName) {
    res.status(400).json({ message: "Nome da instância é obrigatório." });
    return;
  }

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
router.get("/instances/:name/status", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const instanceName = req.params.name;
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
router.get("/instances/:name/qrcode", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const instanceName = req.params.name;
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
router.delete("/instances/:name/logout", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const instanceName = req.params.name;
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
router.put("/instances/:name/restart", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const instanceName = req.params.name;
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
router.delete("/instances/:name", async (req, res) => {
  const cfg = await getUserCfg(req.jwtUser!.id, res);
  if (!cfg) return;

  const instanceName = req.params.name;
  try {
    let result = await evoProxy(
      `${cfg.url}/instance/delete/${instanceName}`,
      cfg.apiKey,
      "DELETE",
      undefined,
      15000,
    );

    if (!result.ok && result.status === 404) {
      result = await evoProxy(
        `${cfg.url}/instance/${instanceName}`,
        cfg.apiKey,
        "DELETE",
        undefined,
        15000,
      );
    }

    if (!result.ok && result.status === 404) {
      res.json({ ok: true, message: "Instância removida (não existia na Evolution API)." });
      return;
    }

    if (!result.ok) {
      const message = extractEvoMessage(result.data, result.status);
      res.status(502).json({ message, evoStatus: result.status });
      return;
    }
    res.json({ ok: true, message: "Instância apagada com sucesso." });
  } catch (err: unknown) {
    req.log.error({ err }, "Erro ao apagar instância");
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    const isTimeout = msg.includes("timeout") || msg.includes("Timeout");
    res.status(502).json({
      message: isTimeout
        ? "Tempo esgotado ao tentar apagar a instância. Verifique se a URL da Evolution API está acessível."
        : `Falha ao apagar a instância: ${msg}`,
    });
  }
});

export default router;

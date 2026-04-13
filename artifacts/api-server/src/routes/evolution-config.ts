import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth-middleware";
import { getConfig, getPublicConfig, saveConfig } from "../store/evolution-config";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/evolution-config", async (req, res) => {
  const userId = req.jwtUser!.id;
  const cfg = await getPublicConfig(userId);
  res.json({ config: cfg ?? null });
});

router.post("/evolution-config", async (req, res) => {
  const userId = req.jwtUser!.id;
  const { url, apiKey } = req.body as {
    url?: string; apiKey?: string;
  };

  if (!url?.trim()) {
    res.status(400).json({ message: "A URL da Evolution API é obrigatória." }); return;
  }

  const existing = await getConfig(userId);
  if (!apiKey?.trim() && !existing?.apiKey) {
    res.status(400).json({ message: "API Key é obrigatória na primeira configuração." }); return;
  }

  try { new URL(url.trim()); } catch {
    res.status(400).json({ message: "URL inválida. Inclua o protocolo (https://)." }); return;
  }

  // Keep existing instance name or auto-generate from userId
  const instanceName = existing?.instanceName || `inst-${userId.replace(/-/g, "").slice(0, 12)}`;

  const saved = await saveConfig(userId, url.trim(), apiKey?.trim() ?? "", instanceName);
  res.json({ config: saved });
});

router.put("/evolution-config", async (req, res) => {
  const userId = req.jwtUser!.id;
  const { url, apiKey, instanceName } = req.body as {
    url?: string; apiKey?: string; instanceName?: string;
  };

  const existing = await getConfig(userId);
  const finalUrl = url?.trim() || existing?.url || "";
  const finalKey = apiKey?.trim() || existing?.apiKey || "";
  const finalInstance = instanceName?.trim() || existing?.instanceName || "";

  if (!finalUrl || !finalKey || !finalInstance) {
    res.status(400).json({ message: "Configure URL, API Key e nome da instância primeiro." }); return;
  }

  const saved = await saveConfig(userId, finalUrl, finalKey, finalInstance);
  res.json({ config: saved });
});

// Tests connectivity using connectionState on the user's bound instance.
// Never calls fetchInstances (which would expose all global instances).
router.post("/evolution-config/test", async (req, res) => {
  const userId = req.jwtUser!.id;
  const cfg = await getConfig(userId);

  if (!cfg) {
    res.status(400).json({ message: "Nenhuma configuração salva. Preencha e salve primeiro." }); return;
  }

  try {
    const response = await fetch(`${cfg.url}/instance/connectionState/${cfg.instanceName}`, {
      method: "GET",
      headers: { apikey: cfg.apiKey },
      signal: AbortSignal.timeout(8000),
    });

    if (response.ok) {
      res.json({ ok: true, message: "Conexão estabelecida com sucesso." });
    } else if (response.status === 404) {
      // API is reachable but instance not created yet — that's fine
      res.json({ ok: true, message: "Conexão com a Evolution API estabelecida. A instância ainda não foi criada." });
    } else {
      const body = await response.text().catch(() => "");
      res.status(502).json({ ok: false, message: `Servidor respondeu com status ${response.status}.`, detail: body.slice(0, 200) });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    req.log.error({ err }, "Falha ao testar Evolution API");
    res.status(502).json({ ok: false, message: `Falha na conexão: ${msg}` });
  }
});

export default router;

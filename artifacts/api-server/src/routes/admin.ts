import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/auth-middleware";
import {
  listUsers,
  findById,
  updateUser,
  deleteUser,
  createUser,
  findByEmail,
  type Role,
} from "../store/users";
import { getPublicConfig, saveConfig, getConfig, listAllConfigs, deleteConfig } from "../store/evolution-config";
import { logAction, getAuditLog } from "../store/audit";

const router: IRouter = Router();
router.use("/admin", requireAdmin);

function adminOf(req: Parameters<Parameters<IRouter["get"]>[1]>[0]) {
  return { id: req.jwtUser!.id, email: req.jwtUser!.email };
}

// ─── GET /admin/users ────────────────────────────────────────
router.get("/admin/users", async (_req, res) => {
  res.json({ users: await listUsers() });
});

// ─── POST /admin/users ───────────────────────────────────────
router.post("/admin/users", async (req, res) => {
  const { name, email, password, role } = req.body as {
    name?: string; email?: string; password?: string; role?: string;
  };

  if (!name?.trim() || !email?.trim() || !password?.trim()) {
    res.status(400).json({ message: "Nome, e-mail e senha são obrigatórios." }); return;
  }
  if (password.length < 6) {
    res.status(400).json({ message: "A senha deve ter pelo menos 6 caracteres." }); return;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    res.status(400).json({ message: "E-mail inválido." }); return;
  }
  if (await findByEmail(email.trim())) {
    res.status(409).json({ message: "E-mail já cadastrado." }); return;
  }

  const userRole: Role = role === "admin" ? "admin" : "user";
  try {
    const newUser = await createUser(name.trim(), email.trim(), password, userRole);
    const admin = adminOf(req);
    await logAction(admin.id, admin.email, "user.create", newUser.id, `Criou usuário ${newUser.email} com role=${userRole}`, newUser.email);
    res.status(201).json({ user: newUser });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao criar usuário.";
    const isDupe = msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique");
    res.status(isDupe ? 409 : 500).json({ message: isDupe ? "E-mail já cadastrado." : msg });
  }
});

// ─── PUT /admin/users/:id ────────────────────────────────────
router.put("/admin/users/:id", async (req, res) => {
  const { id } = req.params;
  const { name } = req.body as { name?: string };

  const existing = await findById(id);
  if (!existing) { res.status(404).json({ message: "Usuário não encontrado." }); return; }
  if (!name?.trim()) { res.status(400).json({ message: "Nome é obrigatório." }); return; }

  const updated = await updateUser(id, { name: name.trim() });
  const admin = adminOf(req);
  await logAction(admin.id, admin.email, "user.update", id, `Atualizou nome para "${name.trim()}"`, existing.email);
  res.json({ user: updated });
});

// ─── PUT /admin/users/:id/role ───────────────────────────────
router.put("/admin/users/:id/role", async (req, res) => {
  const { id } = req.params;
  const { role } = req.body as { role?: string };

  if (req.jwtUser!.id === id) {
    res.status(400).json({ message: "Você não pode alterar sua própria role." }); return;
  }

  const existing = await findById(id);
  if (!existing) { res.status(404).json({ message: "Usuário não encontrado." }); return; }
  if (role !== "admin" && role !== "user") {
    res.status(400).json({ message: "Role inválida. Use 'admin' ou 'user'." }); return;
  }

  const prevRole = existing.role;
  const updated = await updateUser(id, { role });
  const admin = adminOf(req);
  await logAction(admin.id, admin.email, "user.role.change", id, `Alterou role de ${prevRole} → ${role}`, existing.email);
  res.json({ user: updated });
});

// ─── PUT /admin/users/:id/status ────────────────────────────
router.put("/admin/users/:id/status", async (req, res) => {
  const { id } = req.params;
  const { active } = req.body as { active?: boolean };

  if (req.jwtUser!.id === id) {
    res.status(400).json({ message: "Você não pode desativar sua própria conta." }); return;
  }

  const existing = await findById(id);
  if (!existing) { res.status(404).json({ message: "Usuário não encontrado." }); return; }
  if (typeof active !== "boolean") {
    res.status(400).json({ message: "O campo 'active' deve ser boolean." }); return;
  }

  const prevStatus = existing.active;
  const updated = await updateUser(id, { active });
  const admin = adminOf(req);
  const action = active ? "ativou" : "desativou";
  await logAction(admin.id, admin.email, "user.status.change", id, `${action} a conta (era: ${prevStatus ? "ativo" : "inativo"})`, existing.email);
  res.json({ user: updated });
});

// ─── DELETE /admin/users/:id ─────────────────────────────────
router.delete("/admin/users/:id", async (req, res) => {
  const { id } = req.params;

  if (req.jwtUser!.id === id) {
    res.status(400).json({ message: "Você não pode excluir sua própria conta." }); return;
  }

  const existing = await findById(id);
  if (!existing) { res.status(404).json({ message: "Usuário não encontrado." }); return; }

  await deleteUser(id);
  const admin = adminOf(req);
  await logAction(admin.id, admin.email, "user.delete", id, `Excluiu o usuário ${existing.email}`, existing.email);
  res.status(204).send();
});

// ─── GET /admin/users/:id/evolution-config ───────────────────
router.get("/admin/users/:id/evolution-config", async (req, res) => {
  const { id } = req.params;

  const user = await findById(id);
  if (!user) { res.status(404).json({ message: "Usuário não encontrado." }); return; }

  const cfg = await getPublicConfig(id);
  const admin = adminOf(req);
  await logAction(admin.id, admin.email, "evolution-config.admin.view", id, `Visualizou config Evolution do usuário ${user.email}`, user.email);
  res.json({ userId: id, config: cfg });
});

// ─── PUT /admin/users/:id/evolution-config ───────────────────
router.put("/admin/users/:id/evolution-config", async (req, res) => {
  const { id } = req.params;
  const { url, apiKey, instanceName } = req.body as {
    url?: string; apiKey?: string; instanceName?: string;
  };

  const user = await findById(id);
  if (!user) { res.status(404).json({ message: "Usuário não encontrado." }); return; }

  if (!url?.trim() || !instanceName?.trim()) {
    res.status(400).json({ message: "URL e instanceName são obrigatórios." }); return;
  }
  try { new URL(url.trim()); } catch {
    res.status(400).json({ message: "URL inválida. Inclua o protocolo (https://)." }); return;
  }

  const saved = await saveConfig(id, url.trim(), apiKey?.trim() ?? "", instanceName.trim());
  const admin = adminOf(req);
  await logAction(admin.id, admin.email, "evolution-config.admin.update", id, `Atualizou config Evolution do usuário ${user.email}`, user.email);
  res.json({ userId: id, config: saved });
});

// ─── GET /admin/evolution-connections ────────────────────────
router.get("/admin/evolution-connections", async (_req, res) => {
  const [allUsers, configs] = await Promise.all([listUsers(), listAllConfigs()]);
  const configMap = new Map(configs.map((c) => [c.userId, c]));
  const connections = allUsers.map((user) => {
    const cfg = configMap.get(user.id);
    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      active: user.active,
      url: cfg?.url ?? null,
      instanceName: cfg?.instanceName ?? null,
      hasApiKey: cfg?.hasApiKey ?? false,
      hasConfig: !!cfg,
      updatedAt: cfg?.updatedAt ?? null,
    };
  });
  res.json({ connections });
});

// ─── POST /admin/evolution-connections/:userId/test ───────────
router.post("/admin/evolution-connections/:userId/test", async (req, res) => {
  const { userId } = req.params as { userId: string };
  const cfg = await getConfig(userId);
  if (!cfg) {
    res.status(400).json({ ok: false, message: "Nenhuma configuração encontrada para este usuário." });
    return;
  }
  try {
    const response = await fetch(`${cfg.url}/instance/fetchInstances`, {
      method: "GET",
      headers: { apikey: cfg.apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      res.json({ ok: true, message: "Conexão estabelecida com sucesso." });
    } else {
      res.status(502).json({ ok: false, message: `Servidor respondeu com status ${response.status}.` });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    res.status(502).json({ ok: false, message: `Falha na conexão: ${msg}` });
  }
});

// ─── GET /admin/evolution-connections/:userId/instances ───────
router.get("/admin/evolution-connections/:userId/instances", async (req, res) => {
  const { userId } = req.params as { userId: string };
  const cfg = await getConfig(userId);
  if (!cfg) {
    res.status(400).json({ message: "Nenhuma configuração encontrada para este usuário." });
    return;
  }
  try {
    const response = await fetch(`${cfg.url}/instance/fetchInstances`, {
      method: "GET",
      headers: { apikey: cfg.apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      res.status(502).json({ message: `Servidor Evolution respondeu ${response.status}.` });
      return;
    }
    const data: unknown = await response.json();
    const instances = Array.isArray(data) ? data : [];
    res.json({ instances });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    res.status(502).json({ message: `Falha ao buscar instâncias: ${msg}` });
  }
});

// ─── DELETE /admin/evolution-connections/:userId ──────────────
router.delete("/admin/evolution-connections/:userId", async (req, res) => {
  const { userId } = req.params as { userId: string };
  const user = await findById(userId);
  if (!user) { res.status(404).json({ message: "Usuário não encontrado." }); return; }
  await deleteConfig(userId);
  const admin = adminOf(req);
  await logAction(admin.id, admin.email, "evolution-config.admin.delete", userId, `Removeu config Evolution do usuário ${user.email}`, user.email);
  res.status(204).end();
});

// ─── GET /admin/audit ────────────────────────────────────────
router.get("/admin/audit", async (req, res) => {
  const rawLimit = req.query.limit;
  const limit = typeof rawLimit === "string" ? Math.min(parseInt(rawLimit, 10) || 100, 500) : 100;
  const result = await getAuditLog(limit);
  res.json(result);
});

export default router;

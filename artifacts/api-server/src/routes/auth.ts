import { Router, type IRouter } from "express";
import jwt from "jsonwebtoken";
import {
  findByEmail,
  createUser,
  listUsers,
  verifyPassword,
} from "../store/users";
import { requireAuth } from "../lib/auth-middleware";

const router: IRouter = Router();

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ message: "E-mail e senha são obrigatórios." });
      return;
    }

    const user = await findByEmail(email);
    if (!user) {
      res.status(401).json({ message: "E-mail ou senha inválidos." });
      return;
    }

    if (!user.active) {
      res.status(403).json({ message: "Conta desativada. Entre em contato com o administrador." });
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ message: "E-mail ou senha inválidos." });
      return;
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      req.log.error("JWT_SECRET não configurado");
      res.status(500).json({ message: "Erro interno no servidor. JWT_SECRET ausente." });
      return;
    }

    const expiresIn = 60 * 60 * 8;
    const payload = { id: user.id, email: user.email, name: user.name, role: user.role };
    const token = jwt.sign(payload, secret, { expiresIn });

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      expiresIn,
    });
  } catch (err) {
    req.log.error({ err }, "Login error");
    res.status(500).json({ message: "Erro interno ao processar login. Tente novamente." });
  }
});

router.post("/register", async (req, res) => {
  const { name, email, password } = req.body as {
    name?: string; email?: string; password?: string;
  };

  if (!name?.trim() || !email?.trim() || !password?.trim()) {
    res.status(400).json({ message: "Nome, e-mail e senha são obrigatórios." });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ message: "A senha deve ter pelo menos 6 caracteres." });
    return;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ message: "E-mail inválido." });
    return;
  }
  if (await findByEmail(email)) {
    res.status(409).json({ message: "E-mail já cadastrado." });
    return;
  }

  try {
    const newUser = await createUser(name.trim(), email.trim(), password);
    res.status(201).json({ user: newUser });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao criar conta.";
    const isDupe = msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique");
    res.status(isDupe ? 409 : 500).json({ message: isDupe ? "E-mail já cadastrado." : msg });
  }
});

router.get("/users", requireAuth, async (_req, res) => {
  res.json({ users: await listUsers() });
});

export default router;

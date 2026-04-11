import { Router, type IRouter } from "express";
import jwt from "jsonwebtoken";

const router: IRouter = Router();

function verifyToken(authHeader?: string): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) return false;
  try {
    jwt.verify(token, secret);
    return true;
  } catch {
    return false;
  }
}

router.post(/^\/evolution(\/.*)?$/, async (req, res) => {
  if (!verifyToken(req.headers.authorization)) {
    res.status(401).json({ message: "Não autorizado." });
    return;
  }

  const apiKey = process.env.EVOLUTION_API_KEY;
  const evolutionBaseUrl = process.env.EVOLUTION_API_URL;

  if (!apiKey || !evolutionBaseUrl) {
    req.log.error("EVOLUTION_API_KEY ou EVOLUTION_API_URL não configurados");
    res.status(503).json({ message: "Serviço não configurado." });
    return;
  }

  const subPath = req.path.replace(/^\/evolution/, "");
  const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
  const targetUrl = `${evolutionBaseUrl}${subPath}${queryString ? `?${queryString}` : ""}`;

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
      },
      body: JSON.stringify(req.body),
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await response.json();
      res.status(response.status).json(data);
    } else {
      const text = await response.text();
      res.status(response.status).type("text").send(text);
    }
  } catch (err) {
    req.log.error({ err }, "Erro ao chamar Evolution API");
    res.status(502).json({ message: "Erro ao comunicar com o serviço externo." });
  }
});

export default router;

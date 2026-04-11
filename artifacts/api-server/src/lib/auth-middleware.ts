import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "../store/users";

export interface JwtPayload {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      jwtUser?: JwtPayload;
    }
  }
}

export function decodeToken(authHeader?: string): JwtPayload | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    return jwt.verify(token, secret) as JwtPayload;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const payload = decodeToken(req.headers.authorization);
  if (!payload) {
    res.status(401).json({ message: "Não autorizado." });
    return;
  }
  req.jwtUser = payload;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const payload = decodeToken(req.headers.authorization);
  if (!payload) {
    res.status(401).json({ message: "Não autorizado." });
    return;
  }
  if (payload.role !== "admin") {
    res.status(403).json({ message: "Acesso restrito a administradores." });
    return;
  }
  req.jwtUser = payload;
  next();
}

import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config";

export type AccessClaims = { sub: string; username: string };
export type AuthRequest = Request & { user?: AccessClaims };

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createAccessToken(user: AccessClaims): string {
  return jwt.sign(user, config.JWT_SECRET, { expiresIn: config.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"] });
}

export function createRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, nonce: crypto.randomUUID() }, config.REFRESH_TOKEN_SECRET, {
    expiresIn: `${config.REFRESH_TOKEN_TTL_DAYS}d`,
  });
}

export function digestToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const value = req.header("authorization");
  if (!value || !value.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const claims = jwt.verify(value.slice(7), config.JWT_SECRET) as AccessClaims;
    if (!claims.sub || !claims.username) throw new Error("Invalid claims");
    req.user = claims;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired access token" });
  }
}

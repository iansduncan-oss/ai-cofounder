import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { findAdminByEmail } from "@ai-cofounder/db";

export async function authRoutes(app: FastifyInstance) {
  /**
   * POST /api/auth/login
   * Validates credentials and returns an access token + sets a refresh cookie.
   */
  app.post("/login", async (request, reply) => {
    const { email, password } = request.body as { email?: string; password?: string };

    if (!email || !password) {
      return reply.status(400).send({ error: "email and password are required" });
    }

    const admin = await findAdminByEmail(app.db, email);
    if (!admin) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const passwordMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!passwordMatch) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    // Sign access token (15min expiry configured in auth plugin)
    const accessToken = await reply.jwtSign({ sub: admin.id, email: admin.email });

    // Sign refresh token (7d expiry)
    const refreshToken = app.jwt.sign(
      { sub: admin.id, type: "refresh" },
      { expiresIn: "7d" },
    );

    // Set refresh token as HttpOnly cookie scoped to /api/auth/refresh
    reply.setCookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/auth/refresh",
      maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
    });

    return reply.status(200).send({ accessToken });
  });

  /**
   * POST /api/auth/refresh
   * Exchanges a valid refresh cookie for a new access token.
   */
  app.post("/refresh", async (request, reply) => {
    const refreshToken = request.cookies?.refreshToken;

    if (!refreshToken) {
      return reply.status(401).send({ error: "No refresh token" });
    }

    try {
      const payload = app.jwt.verify(refreshToken) as Record<string, unknown>;

      if (payload.type !== "refresh") {
        reply.clearCookie("refreshToken");
        return reply.status(401).send({ error: "Invalid refresh token" });
      }

      const accessToken = await reply.jwtSign({ sub: payload.sub });
      return reply.status(200).send({ accessToken });
    } catch {
      reply.clearCookie("refreshToken");
      return reply.status(401).send({ error: "Invalid or expired refresh token" });
    }
  });

  /**
   * POST /api/auth/logout
   * Clears the refresh token cookie.
   */
  app.post("/logout", async (_request, reply) => {
    reply.clearCookie("refreshToken", { path: "/api/auth/refresh" });
    return reply.status(200).send({ success: true });
  });
}

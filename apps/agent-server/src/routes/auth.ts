import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { findAdminByEmail, createAdminUser, upsertGoogleToken, upsertAppSetting } from "@ai-cofounder/db";
import { optionalEnv, createLogger } from "@ai-cofounder/shared";
import { encryptToken, isEncryptionConfigured } from "../services/crypto.js";
import { getGoogleConnectionStatus, disconnectGoogle } from "../services/google-auth.js";

const logger = createLogger("auth");

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar",
].join(" ");

const LoginBody = Type.Object({
  email: Type.String({ format: "email", maxLength: 255 }),
  password: Type.String({ minLength: 1, maxLength: 256 }),
});
type LoginBody = Static<typeof LoginBody>;

function getGoogleConfig() {
  const clientId = optionalEnv("GOOGLE_CLIENT_ID", "");
  const clientSecret = optionalEnv("GOOGLE_CLIENT_SECRET", "");
  const redirectUri = optionalEnv("GOOGLE_REDIRECT_URI", "");
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export async function authRoutes(app: FastifyInstance) {
  /**
   * POST /api/auth/login
   * Validates credentials and returns an access token + sets a refresh cookie.
   */
  app.post<{ Body: LoginBody }>("/login", { schema: { body: LoginBody } }, async (request, reply) => {
    const { email, password } = request.body;

    const admin = await findAdminByEmail(app.db, email);
    if (!admin) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    // OAuth-only users have no password — reject password login
    if (!admin.passwordHash) {
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

  /* ────────────────── Google OAuth ────────────────── */

  /**
   * GET /api/auth/google/client-id
   * Returns the Google client ID so the dashboard can conditionally show the button.
   */
  app.get("/google/client-id", async (_request, reply) => {
    const config = getGoogleConfig();
    if (!config) {
      return reply.status(404).send({ error: "Google OAuth not configured" });
    }
    return reply.send({ clientId: config.clientId });
  });

  /**
   * GET /api/auth/google
   * Builds Google OAuth URL and redirects the browser to Google's consent screen.
   */
  app.get("/google", async (_request, reply) => {
    const config = getGoogleConfig();
    if (!config) {
      return reply.status(404).send({ error: "Google OAuth not configured" });
    }

    const state = crypto.randomUUID();

    // Store state in a short-lived cookie for CSRF verification
    reply.setCookie("oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth/google/callback",
      maxAge: 300, // 5 minutes
    });

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES,
      state,
      access_type: "offline",
      prompt: "consent", // Forces refresh token grant
    });

    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  /**
   * GET /api/auth/google/callback
   * Google redirects here with ?code=...&state=...
   * Exchanges code for tokens, finds/creates admin, issues JWT.
   */
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/google/callback",
    async (request, reply) => {
      const { code, state, error: oauthError } = request.query;

      if (oauthError) {
        return reply.redirect("/dashboard/login?error=oauth_denied");
      }

      if (!code || !state) {
        return reply.redirect("/dashboard/login?error=oauth_invalid");
      }

      // Verify CSRF state
      const storedState = request.cookies?.oauth_state;
      reply.clearCookie("oauth_state", { path: "/api/auth/google/callback" });

      if (!storedState || storedState !== state) {
        return reply.redirect("/dashboard/login?error=oauth_state_mismatch");
      }

      const config = getGoogleConfig();
      if (!config) {
        return reply.redirect("/dashboard/login?error=oauth_not_configured");
      }

      // Exchange authorization code for tokens
      let tokenData: {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
      };
      try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: config.redirectUri,
            grant_type: "authorization_code",
          }),
        });

        if (!tokenRes.ok) {
          return reply.redirect("/dashboard/login?error=oauth_token_exchange");
        }

        tokenData = (await tokenRes.json()) as typeof tokenData;
      } catch {
        return reply.redirect("/dashboard/login?error=oauth_token_exchange");
      }

      if (!tokenData.access_token) {
        return reply.redirect("/dashboard/login?error=oauth_token_exchange");
      }

      // Fetch user info from Google
      let userInfo: { email?: string };
      try {
        const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });

        if (!userRes.ok) {
          return reply.redirect("/dashboard/login?error=oauth_userinfo");
        }

        userInfo = (await userRes.json()) as { email?: string };
      } catch {
        return reply.redirect("/dashboard/login?error=oauth_userinfo");
      }

      if (!userInfo.email) {
        return reply.redirect("/dashboard/login?error=oauth_no_email");
      }

      // Find or create admin user
      let admin = await findAdminByEmail(app.db, userInfo.email);
      if (!admin) {
        admin = await createAdminUser(app.db, {
          email: userInfo.email,
          passwordHash: null,
        });
      }

      // Persist encrypted Google tokens for Gmail/Calendar access
      if (tokenData.refresh_token && isEncryptionConfigured()) {
        try {
          const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000);
          await upsertGoogleToken(app.db, {
            adminUserId: admin.id,
            accessTokenEncrypted: encryptToken(tokenData.access_token),
            refreshTokenEncrypted: encryptToken(tokenData.refresh_token),
            expiresAt,
            scopes: tokenData.scope ?? GOOGLE_SCOPES,
          });
          logger.info({ adminUserId: admin.id }, "Google OAuth tokens stored");

          // Persist as primary admin for background jobs (briefings, meeting prep)
          await upsertAppSetting(app.db, "primary_admin_user_id", admin.id);
        } catch (err) {
          logger.warn({ err }, "Failed to store Google tokens (non-fatal)");
        }
      }

      // Issue JWT + refresh cookie (same as password login)
      const accessToken = await reply.jwtSign({ sub: admin.id, email: admin.email });

      const refreshToken = app.jwt.sign(
        { sub: admin.id, type: "refresh" },
        { expiresIn: "7d" },
      );

      reply.setCookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/auth/refresh",
        maxAge: 7 * 24 * 60 * 60,
      });

      // Redirect to dashboard callback page with token in query
      return reply.redirect(`/dashboard/auth/callback?token=${encodeURIComponent(accessToken)}`);
    },
  );

  /**
   * GET /api/auth/google/status
   * Returns whether the user has connected Google (requires JWT).
   */
  app.get("/google/status", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const { sub } = request.user as { sub: string };
    const status = await getGoogleConnectionStatus(app.db, sub);
    return reply.send(status);
  });

  /**
   * DELETE /api/auth/google/disconnect
   * Revokes Google tokens and removes from DB (requires JWT).
   */
  app.delete("/google/disconnect", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const { sub } = request.user as { sub: string };
    await disconnectGoogle(app.db, sub);
    return reply.send({ success: true });
  });
}

import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { countAdminUsers, createAdminUser } from "@ai-cofounder/db";

const logger = createLogger("auth-plugin");

export const authPlugin = fp(async (app: FastifyInstance) => {
  const jwtSecret = optionalEnv("JWT_SECRET", "");
  const cookieSecret = optionalEnv("COOKIE_SECRET", "");

  if (!jwtSecret || !cookieSecret) {
    logger.warn("JWT_SECRET or COOKIE_SECRET not set — auth plugin disabled (set both in production)");
    return;
  }

  // Register @fastify/cookie for reading/setting cookies
  await app.register(import("@fastify/cookie"), {
    secret: cookieSecret,
  });

  // Register @fastify/jwt for signing/verifying JWTs
  await app.register(import("@fastify/jwt"), {
    secret: jwtSecret,
    sign: { expiresIn: "15m" },
  });

  // Admin seed: auto-create admin user on first startup if none exist
  app.addHook("onReady", async () => {
    const adminEmail = optionalEnv("ADMIN_EMAIL", "");
    const adminPassword = optionalEnv("ADMIN_PASSWORD", "");

    if (!adminEmail || !adminPassword) {
      logger.info("ADMIN_EMAIL or ADMIN_PASSWORD not set — skipping admin seed");
      return;
    }

    try {
      const count = await countAdminUsers(app.db);
      if (count === 0) {
        const passwordHash = await bcrypt.hash(adminPassword, 12);
        await createAdminUser(app.db, { email: adminEmail, passwordHash });
        logger.info({ email: adminEmail }, "admin user seeded on startup");
      } else {
        logger.info({ count }, "admin user(s) exist — skipping seed");
      }
    } catch (err) {
      logger.warn({ err }, "failed to seed admin user (non-fatal)");
    }
  });
});

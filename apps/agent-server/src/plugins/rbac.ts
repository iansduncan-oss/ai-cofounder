import type { FastifyRequest, FastifyReply } from "fastify";

export type AdminRole = "admin" | "editor" | "viewer";

/**
 * Fastify preHandler that checks JWT payload for required role(s).
 * Must be used on routes inside jwtGuardPlugin (after JWT verification).
 * Loopback/Docker requests that bypass JWT get automatic admin access.
 */
export function requireRole(...roles: AdminRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { sub?: string; role?: string } | undefined;

    // If no user in request (loopback/dev bypass), allow through
    if (!user?.sub) return;

    const userRole = (user.role ?? "viewer") as AdminRole;
    if (!roles.includes(userRole)) {
      return reply.status(403).send({ error: "Forbidden: insufficient permissions" });
    }
  };
}

/** Convenience: admin + editor */
export const requireEditor = requireRole("admin", "editor");

/** Convenience: admin only */
export const requireAdmin = requireRole("admin");

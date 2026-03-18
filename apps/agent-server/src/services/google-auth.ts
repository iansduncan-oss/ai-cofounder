import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { getGoogleToken, upsertGoogleToken, deleteGoogleToken, type Db } from "@ai-cofounder/db";
import { encryptToken, decryptToken } from "./crypto.js";

const logger = createLogger("google-auth");

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}

function getGoogleConfig() {
  const clientId = optionalEnv("GOOGLE_CLIENT_ID", "");
  const clientSecret = optionalEnv("GOOGLE_CLIENT_SECRET", "");
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Get a valid Google access token for a user, refreshing if near expiry.
 * Returns null if no tokens are stored.
 */
export async function getValidGoogleToken(
  db: Db,
  adminUserId: string,
): Promise<string | null> {
  const record = await getGoogleToken(db, adminUserId);
  if (!record) return null;

  // If token is valid for more than 5 minutes, use it
  const bufferMs = 5 * 60 * 1000;
  if (record.expiresAt.getTime() > Date.now() + bufferMs) {
    return decryptToken(record.accessTokenEncrypted);
  }

  // Refresh the token
  const config = getGoogleConfig();
  if (!config) {
    logger.warn("Google OAuth not configured — cannot refresh token");
    return null;
  }

  const refreshToken = decryptToken(record.refreshTokenEncrypted);
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error({ status: res.status, body: text }, "Google token refresh failed");
      // If refresh token is revoked, delete the stored tokens
      if (res.status === 400 || res.status === 401) {
        await deleteGoogleToken(db, adminUserId);
      }
      return null;
    }

    const data = (await res.json()) as GoogleTokenResponse;
    const newExpiresAt = new Date(Date.now() + data.expires_in * 1000);

    await upsertGoogleToken(db, {
      adminUserId,
      accessTokenEncrypted: encryptToken(data.access_token),
      refreshTokenEncrypted: record.refreshTokenEncrypted, // Refresh token doesn't change
      expiresAt: newExpiresAt,
      scopes: data.scope ?? record.scopes,
    });

    logger.debug({ adminUserId }, "Google access token refreshed");
    return data.access_token;
  } catch (err) {
    logger.error({ err }, "Failed to refresh Google token");
    return null;
  }
}

/**
 * Check if a user has connected their Google account.
 */
export async function isGoogleConnected(db: Db, adminUserId: string): Promise<boolean> {
  const record = await getGoogleToken(db, adminUserId);
  return !!record;
}

/**
 * Get Google connection status for a user.
 */
export async function getGoogleConnectionStatus(db: Db, adminUserId: string) {
  const record = await getGoogleToken(db, adminUserId);
  if (!record) {
    return { connected: false, scopes: null, expiresAt: null };
  }
  return {
    connected: true,
    scopes: record.scopes.split(" "),
    expiresAt: record.expiresAt.toISOString(),
  };
}

/**
 * Revoke Google tokens and delete from DB.
 */
export async function disconnectGoogle(db: Db, adminUserId: string): Promise<void> {
  const record = await getGoogleToken(db, adminUserId);
  if (!record) return;

  // Attempt to revoke at Google (best effort)
  try {
    const accessToken = decryptToken(record.accessTokenEncrypted);
    await fetch(`https://oauth2.googleapis.com/revoke?token=${accessToken}`, {
      method: "POST",
    });
  } catch {
    // Revocation failure is non-fatal
  }

  await deleteGoogleToken(db, adminUserId);
  logger.info({ adminUserId }, "Google account disconnected");
}

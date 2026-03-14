import type { Express, RequestHandler } from "express";
import { createHash, randomBytes } from "crypto";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logger } from "../services/logger";

/** Hash an API key using SHA-256 */
function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Generate a new API key with prefix */
function generateApiKey(): { key: string; keyHash: string; keyPrefix: string } {
  const raw = randomBytes(32).toString("base64url");
  const key = `obs_k_${raw}`;
  const keyHash = hashApiKey(key);
  const keyPrefix = key.slice(0, 12); // "obs_k_XXXXXX"
  return { key, keyHash, keyPrefix };
}

/**
 * Middleware that authenticates via API key in Authorization header.
 * Format: Authorization: Bearer obs_k_<key>
 *
 * Sets req.orgId and req.user if valid key found.
 * Falls through to session auth if no Bearer token present.
 */
export const apiKeyAuth: RequestHandler = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer obs_k_")) {
    return next(); // No API key — fall through to session auth
  }

  const key = authHeader.slice(7); // Remove "Bearer "
  const keyHash = hashApiKey(key);

  try {
    const apiKey = await storage.getApiKeyByHash(keyHash);
    if (!apiKey) {
      return res.status(401).json({ message: "Invalid API key" });
    }

    // Check expiry
    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
      return res.status(401).json({ message: "API key has expired" });
    }

    // Set org context
    req.orgId = apiKey.orgId;

    // Derive a virtual user for API key requests
    const permLevel = apiKey.permissions.includes("admin")
      ? "admin"
      : apiKey.permissions.includes("write")
        ? "manager"
        : "viewer";

    (req as any).user = {
      id: `apikey:${apiKey.id}`,
      username: `api:${apiKey.name}`,
      name: apiKey.name,
      role: permLevel,
      orgId: apiKey.orgId,
      orgSlug: "",
    };

    // Update last used (fire and forget)
    storage.updateApiKey(apiKey.orgId, apiKey.id, {
      lastUsedAt: new Date().toISOString(),
    }).catch(() => {});

    next();
  } catch (error) {
    logger.error({ err: error }, "API key auth error");
    res.status(500).json({ message: "Authentication error" });
  }
};

export function registerApiKeyRoutes(app: Express): void {
  // List API keys for current org (admin only)
  app.get("/api/api-keys", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const keys = await storage.listApiKeys(req.orgId!);
      // Never return the hash — only metadata
      res.json(keys.map(k => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        permissions: k.permissions,
        createdBy: k.createdBy,
        status: k.status,
        expiresAt: k.expiresAt,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
      })));
    } catch (error) {
      res.status(500).json({ message: "Failed to list API keys" });
    }
  });

  // Create a new API key (admin only)
  app.post("/api/api-keys", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const { name, permissions, expiresInDays } = req.body;
      if (!name) {
        return res.status(400).json({ message: "Name is required" });
      }

      const validPerms = ["read", "write", "admin"];
      const perms: string[] = Array.isArray(permissions)
        ? permissions.filter((p: string) => validPerms.includes(p))
        : ["read"];

      if (perms.length === 0) perms.push("read");

      const { key, keyHash, keyPrefix } = generateApiKey();

      const expiresAt = expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined;

      const apiKey = await storage.createApiKey(req.orgId!, {
        name,
        keyHash,
        keyPrefix,
        permissions: perms,
        createdBy: req.user!.username,
        expiresAt,
      });

      logger.info({ orgId: req.orgId, keyId: apiKey.id, name }, "API key created");

      // Return the full key ONLY on creation (it's never stored/returned again)
      res.status(201).json({
        id: apiKey.id,
        name: apiKey.name,
        key, // Only time the full key is returned
        keyPrefix: apiKey.keyPrefix,
        permissions: apiKey.permissions,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to create API key");
      res.status(500).json({ message: "Failed to create API key" });
    }
  });

  // Revoke an API key (admin only)
  app.patch("/api/api-keys/:id/revoke", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const updated = await storage.updateApiKey(req.orgId!, req.params.id, { status: "revoked" });
      if (!updated) {
        return res.status(404).json({ message: "API key not found" });
      }
      logger.info({ orgId: req.orgId, keyId: req.params.id }, "API key revoked");
      res.json({ message: "API key revoked" });
    } catch (error) {
      res.status(500).json({ message: "Failed to revoke API key" });
    }
  });

  // Delete an API key permanently (admin only)
  app.delete("/api/api-keys/:id", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      await storage.deleteApiKey(req.orgId!, req.params.id);
      res.json({ message: "API key deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete API key" });
    }
  });
}

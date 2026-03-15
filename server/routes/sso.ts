import type { Express, Request, Response, NextFunction } from "express";
import passport from "passport";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { logPhiAccess } from "../services/audit-log";
import type { Organization, OrgSettings } from "../../shared/schema";

/**
 * SAML 2.0 SSO authentication flow (Enterprise plan feature).
 *
 * Per-org IDP configuration is stored in org.settings (ssoProvider, ssoEntityId,
 * ssoSignOnUrl, ssoCertificate, ssoEnforced).
 *
 * Flow:
 * 1. User visits GET /api/auth/sso/:orgSlug → redirected to org's IDP
 * 2. IDP authenticates user and POSTs assertion → POST /api/auth/sso/callback
 * 3. Server validates assertion, finds/creates user, creates session
 * 4. User redirected to /dashboard
 *
 * SP metadata available at GET /api/auth/sso/metadata/:orgSlug
 */

let samlConfigured = false;

interface SamlProfile {
  nameID: string;
  nameIDFormat?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  [key: string]: unknown;
}

/**
 * Resolve the base URL for constructing SAML callback and issuer URLs.
 * Uses X-Forwarded headers in production (behind reverse proxy) or req.headers.host.
 */
function getBaseUrl(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
  return `${proto}://${host}`;
}

/**
 * Look up an org by slug and extract its SSO settings.
 * Returns null if org not found or SSO not configured.
 */
async function getOrgSsoConfig(
  orgSlug: string
): Promise<{ org: Organization; settings: OrgSettings } | null> {
  const org = await storage.getOrganizationBySlug(orgSlug);
  if (!org) return null;

  const settings = org.settings as OrgSettings | undefined;
  if (!settings?.ssoProvider || !settings.ssoSignOnUrl || !settings.ssoCertificate) {
    return null;
  }

  return { org, settings };
}

export async function setupSamlAuth(): Promise<boolean> {
  try {
    const { MultiSamlStrategy } = await import("@node-saml/passport-saml");

    passport.use(
      "saml",
      new MultiSamlStrategy(
        {
          passReqToCallback: true,
          getSamlOptions: async (req: Request, done: (err: Error | null, options?: any) => void) => {
            try {
              // Extract orgSlug from the relay state or from the request path
              // During initiation: orgSlug is in req.params
              // During callback: orgSlug is passed via RelayState
              const orgSlug =
                (req as any).params?.orgSlug ||
                (req.body?.RelayState as string) ||
                (req.query?.RelayState as string);

              if (!orgSlug) {
                return done(new Error("No organization context for SSO"));
              }

              const config = await getOrgSsoConfig(orgSlug);
              if (!config) {
                return done(new Error(`SSO not configured for organization: ${orgSlug}`));
              }

              const { settings } = config;
              const baseUrl = getBaseUrl(req);

              done(null, {
                entryPoint: settings.ssoSignOnUrl,
                issuer: settings.ssoEntityId || `${baseUrl}/api/auth/sso/metadata/${orgSlug}`,
                cert: settings.ssoCertificate,
                callbackUrl: `${baseUrl}/api/auth/sso/callback`,
                identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
                wantAssertionsSigned: true,
                additionalParams: {
                  RelayState: orgSlug,
                },
              });
            } catch (err) {
              done(err as Error);
            }
          },
        },
        // Verify callback (with request)
        async (
          req: Request,
          profile: SamlProfile | null,
          done: (err: Error | null, user?: Record<string, unknown>, info?: any) => void
        ) => {
          try {
            if (!profile) {
              return done(null, undefined, { message: "No SAML profile received" });
            }

            const email = profile.email || profile.nameID;
            if (!email) {
              return done(null, undefined, { message: "No email in SAML assertion" });
            }

            // Resolve org from RelayState
            const orgSlug =
              (req.body?.RelayState as string) || (req.query?.RelayState as string);
            if (!orgSlug) {
              return done(null, undefined, { message: "No organization context in SAML response" });
            }

            const config = await getOrgSsoConfig(orgSlug);
            if (!config) {
              return done(null, undefined, { message: `SSO not configured for org: ${orgSlug}` });
            }

            const { org } = config;

            // Try to find existing user by email/username
            let user = await storage.getUserByUsername(email);

            if (user) {
              // Verify user belongs to this org
              if (user.orgId !== org.id) {
                return done(null, undefined, {
                  message: "User account exists in a different organization",
                });
              }

              logPhiAccess({
                event: "login_success",
                orgId: org.id,
                userId: user.id,
                username: user.username,
                role: user.role,
                resourceType: "auth",
                detail: `SSO login via ${config.settings.ssoProvider} (org: ${orgSlug})`,
              });

              return done(null, {
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role,
                orgId: org.id,
                orgSlug: org.slug,
              });
            }

            // Auto-provision new user (similar to Google OAuth flow)
            const { randomBytes } = await import("crypto");
            const displayName =
              profile.displayName ||
              [profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
              email.split("@")[0];

            const newUser = await storage.createUser({
              orgId: org.id,
              username: email,
              // SSO users can't login with password — hash a random value
              passwordHash: `saml:${randomBytes(32).toString("hex")}`,
              name: displayName,
              role: "viewer", // Default role for auto-provisioned SSO users
            });

            logger.info(
              { userId: newUser.id, email, orgId: org.id, orgSlug },
              "Auto-provisioned user via SAML SSO"
            );

            logPhiAccess({
              event: "login_success",
              orgId: org.id,
              userId: newUser.id,
              username: newUser.username,
              role: newUser.role,
              resourceType: "auth",
              detail: `SSO login (new user) via ${config.settings.ssoProvider} (org: ${orgSlug})`,
            });

            return done(null, {
              id: newUser.id,
              username: newUser.username,
              name: newUser.name,
              role: newUser.role,
              orgId: org.id,
              orgSlug: org.slug,
            });
          } catch (err) {
            return done(err as Error);
          }
        },
        // Logout verify callback (required by MultiSamlStrategy)
        async (
          _req: Request,
          profile: SamlProfile | null,
          done: (err: Error | null, user?: Record<string, unknown>) => void
        ) => {
          // SLO (Single Logout) — just acknowledge the logout
          if (profile?.nameID) {
            const user = await storage.getUserByUsername(profile.nameID);
            if (user) {
              const org = await storage.getOrganization(user.orgId);
              return done(null, {
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role,
                orgId: user.orgId,
                orgSlug: org?.slug || "default",
              });
            }
          }
          done(null, undefined);
        }
      )
    );

    samlConfigured = true;
    logger.info("[SSO] SAML authentication configured (multi-tenant, per-org IDP)");
    return true;
  } catch (error) {
    logger.warn({ err: error }, "[SSO] Failed to configure SAML authentication — @node-saml/passport-saml may not be installed");
    return false;
  }
}

export function isSamlConfigured(): boolean {
  return samlConfigured;
}

export function registerSsoRoutes(app: Express): void {
  // Initiate SAML login for a specific organization
  app.get("/api/auth/sso/:orgSlug", async (req: Request, res: Response, next: NextFunction) => {
    if (!samlConfigured) {
      return res.status(503).json({ message: "SAML SSO not available" });
    }

    const { orgSlug } = req.params;

    // Verify org exists and has SSO configured
    const config = await getOrgSsoConfig(orgSlug);
    if (!config) {
      return res.status(404).json({
        message: `SSO not configured for organization: ${orgSlug}`,
      });
    }

    logger.info({ orgSlug }, "Initiating SAML SSO login");

    passport.authenticate("saml", {
      additionalParams: {
        RelayState: orgSlug,
      },
    } as any)(req, res, next);
  });

  // SAML Assertion Consumer Service (ACS) — IDP posts assertion here
  app.post("/api/auth/sso/callback", (req: Request, res: Response, next: NextFunction) => {
    if (!samlConfigured) {
      return res.redirect("/?error=sso_not_configured");
    }

    passport.authenticate(
      "saml",
      (err: any, user: Express.User | false, info: any) => {
        if (err) {
          logger.error({ err }, "SAML SSO callback error");
          return res.redirect("/?error=sso_error");
        }

        if (!user) {
          const message = encodeURIComponent(info?.message || "SSO authentication failed");
          return res.redirect(`/?error=${message}`);
        }

        req.login(user, (loginErr) => {
          if (loginErr) {
            logger.error({ err: loginErr }, "SAML SSO session creation error");
            return res.redirect("/?error=sso_login_error");
          }

          logger.info(
            { userId: user.id, orgId: user.orgId },
            "SAML SSO login successful"
          );

          res.redirect("/dashboard");
        });
      }
    )(req, res, next);
  });

  // SP Metadata endpoint — provides IDP with our service provider configuration
  app.get(
    "/api/auth/sso/metadata/:orgSlug",
    async (req: Request, res: Response) => {
      if (!samlConfigured) {
        return res.status(503).json({ message: "SAML SSO not available" });
      }

      const { orgSlug } = req.params;
      const config = await getOrgSsoConfig(orgSlug);

      const baseUrl = getBaseUrl(req);
      const entityId = config?.settings.ssoEntityId || `${baseUrl}/api/auth/sso/metadata/${orgSlug}`;
      const acsUrl = `${baseUrl}/api/auth/sso/callback`;

      const metadata = `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${entityId}">
  <md:SPSSODescriptor
    AuthnRequestsSigned="false"
    WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${acsUrl}"
      index="1"
      isDefault="true" />
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;

      res.set("Content-Type", "application/xml");
      res.send(metadata);
    }
  );
}

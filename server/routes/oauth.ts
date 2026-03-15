import type { Express } from "express";
import passport from "passport";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { isSamlConfigured } from "./sso";

/**
 * Google OAuth 2.0 login flow.
 *
 * Requires environment variables:
 * - GOOGLE_CLIENT_ID
 * - GOOGLE_CLIENT_SECRET
 * - GOOGLE_CALLBACK_URL (optional, defaults to /api/auth/google/callback)
 *
 * Flow:
 * 1. User clicks "Sign in with Google" → GET /api/auth/google
 * 2. Redirects to Google consent screen
 * 3. Google redirects back → GET /api/auth/google/callback
 * 4. Server matches Google email to existing user or creates new one
 * 5. Session created, redirect to app
 */

let googleOAuthConfigured = false;

export async function setupGoogleOAuth(): Promise<boolean> {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientID || !clientSecret) {
    logger.info("[OAUTH] Google OAuth not configured (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)");
    return false;
  }

  try {
    const { Strategy: GoogleStrategy } = await import("passport-google-oauth20");

    const callbackURL = process.env.GOOGLE_CALLBACK_URL || "/api/auth/google/callback";

    passport.use(
      new GoogleStrategy(
        { clientID, clientSecret, callbackURL },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value;
            if (!email) {
              return done(null, false, { message: "No email associated with Google account" });
            }

            // Look up user by username (email)
            let user = await storage.getUserByUsername(email);

            if (user) {
              // Existing user — resolve org for session
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

            // Check if email domain matches any org's emailDomain setting
            const emailDomain = email.split("@")[1];
            const orgs = await storage.listOrganizations();
            const matchingOrg = orgs.find(
              (o) => o.settings?.emailDomain && o.settings.emailDomain === emailDomain
            );

            if (matchingOrg) {
              // Auto-provision user for matching org domain
              const { randomBytes } = await import("crypto");
              const newUser = await storage.createUser({
                orgId: matchingOrg.id,
                username: email,
                passwordHash: `google:${randomBytes(32).toString("hex")}`, // Can't be used for password login
                name: profile.displayName || email.split("@")[0],
                role: "viewer", // Default role for auto-provisioned users
              });

              logger.info(
                { userId: newUser.id, email, orgId: matchingOrg.id },
                "Auto-provisioned user via Google OAuth"
              );

              return done(null, {
                id: newUser.id,
                username: newUser.username,
                name: newUser.name,
                role: newUser.role,
                orgId: matchingOrg.id,
                orgSlug: matchingOrg.slug,
              });
            }

            // No matching user or org — reject
            return done(null, false, {
              message: "No account found for this email. Contact your admin for an invitation.",
            });
          } catch (err) {
            return done(err as Error);
          }
        }
      )
    );

    googleOAuthConfigured = true;
    logger.info("[OAUTH] Google OAuth configured successfully");
    return true;
  } catch (error) {
    logger.error({ err: error }, "[OAUTH] Failed to configure Google OAuth");
    return false;
  }
}

export function registerOAuthRoutes(app: Express): void {
  // Check which auth providers are available
  app.get("/api/auth/providers", (_req, res) => {
    res.json({
      google: googleOAuthConfigured,
      local: true,
      saml: isSamlConfigured(),
    });
  });

  // Initiate Google OAuth flow
  app.get("/api/auth/google", (req, res, next) => {
    if (!googleOAuthConfigured) {
      return res.status(503).json({ message: "Google OAuth not configured" });
    }
    passport.authenticate("google", {
      scope: ["profile", "email"],
    })(req, res, next);
  });

  // Google OAuth callback
  app.get("/api/auth/google/callback", (req, res, next) => {
    if (!googleOAuthConfigured) {
      return res.redirect("/?error=oauth_not_configured");
    }

    passport.authenticate("google", (err: any, user: Express.User | false, info: any) => {
      if (err) {
        logger.error({ err }, "Google OAuth error");
        return res.redirect("/?error=oauth_error");
      }
      if (!user) {
        const message = encodeURIComponent(info?.message || "Authentication failed");
        return res.redirect(`/?error=${message}`);
      }
      req.login(user, (loginErr) => {
        if (loginErr) {
          logger.error({ err: loginErr }, "Google OAuth login error");
          return res.redirect("/?error=login_error");
        }
        res.redirect("/");
      });
    })(req, res, next);
  });
}

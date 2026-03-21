import type { Express } from "express";
import passport from "passport";
import { storage } from "../storage";

export function registerAuthRoutes(app: Express): void {
  // ==================== AUTH ROUTES (unauthenticated) ====================
  // Users are managed via AUTH_USERS environment variable (no registration)

  // Login — now MFA-aware
  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", async (err: any, user: Express.User | false, info: any) => {
      if (err) return next(err);
      if (!user) {
        const errorCode = info?.message?.includes("locked") ? "OBS-AUTH-002" : "OBS-AUTH-001";
        return res.status(401).json({ message: info?.message || "Invalid credentials", errorCode });
      }

      // Check if user has MFA enabled — if so, return challenge instead of session
      try {
        const dbUser = await storage.getUser(user.id);
        if (dbUser?.mfaEnabled) {
          // Don't create a session yet — require MFA verification
          return res.json({
            mfaRequired: true,
            userId: user.id,
            message: "MFA verification required",
          });
        }

        // Check if org enforces MFA and user hasn't set it up yet
        const org = await storage.getOrganization(user.orgId);
        if (org?.settings?.mfaRequired && !dbUser?.mfaEnabled) {
          // Allow login but flag that MFA setup is required
          req.session.regenerate((regenErr) => {
            if (regenErr) return next(regenErr);
            req.login(user, (loginErr) => {
              if (loginErr) return next(loginErr);
              res.json({
                id: user.id, username: user.username, name: user.name,
                role: user.role, orgId: user.orgId, orgSlug: user.orgSlug,
                mfaSetupRequired: true,
                message: "Your organization requires MFA. Please set it up immediately.",
              });
            });
          });
          return;
        }
      } catch {
        // If user lookup fails (e.g. env user), proceed without MFA
      }

      // Regenerate session ID on login to prevent session fixation attacks
      req.session.regenerate((regenErr) => {
        if (regenErr) return next(regenErr);
        req.login(user, (loginErr) => {
          if (loginErr) return next(loginErr);
          res.json({ id: user.id, username: user.username, name: user.name, role: user.role, orgId: user.orgId, orgSlug: user.orgSlug });
        });
      });
    })(req, res, next);
  });

  // Logout — destroy session to clear server-side session data
  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        res.status(500).json({ message: "Failed to logout" });
        return;
      }
      req.session.destroy(() => {
        // Always clear the cookie regardless of destroy success/failure
        res.clearCookie("connect.sid");
        res.json({ message: "Logged out" });
      });
    });
  });

  // Get current session user
  app.get("/api/auth/me", (req, res) => {
    if (req.isAuthenticated() && req.user) {
      res.json(req.user);
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  });
}

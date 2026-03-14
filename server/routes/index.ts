import type { Express } from "express";
import { createServer, type Server } from "http";
import { registerHealthRoutes } from "./health";
import { registerAuthRoutes } from "./auth";
import { registerAccessRoutes } from "./access";
import { registerAdminRoutes } from "./admin";
import { registerDashboardRoutes } from "./dashboard";
import { registerEmployeeRoutes } from "./employees";
import { registerCallRoutes } from "./calls";
import { registerReportRoutes } from "./reports";
import { registerCoachingRoutes } from "./coaching";
import { registerInsightRoutes } from "./insights";
import { registerRegistrationRoutes } from "./registration";
import { registerApiKeyRoutes, apiKeyAuth } from "./api-keys";
import { registerOAuthRoutes, setupGoogleOAuth } from "./oauth";
import { registerBillingRoutes } from "./billing";
import { registerOnboardingRoutes } from "./onboarding";

export async function registerRoutes(app: Express): Promise<Server> {
  // API key auth middleware (before routes, after session middleware)
  app.use("/api", apiKeyAuth);

  // Set up Google OAuth if configured
  await setupGoogleOAuth();

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerOAuthRoutes(app);
  registerRegistrationRoutes(app);
  registerAccessRoutes(app);
  registerAdminRoutes(app);
  registerApiKeyRoutes(app);
  registerBillingRoutes(app);
  registerOnboardingRoutes(app);
  registerDashboardRoutes(app);
  registerEmployeeRoutes(app);
  registerCallRoutes(app);
  registerReportRoutes(app);
  registerCoachingRoutes(app);
  registerInsightRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}

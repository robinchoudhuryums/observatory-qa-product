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
import { registerPasswordResetRoutes } from "./password-reset";
import { registerExportRoutes } from "./export";
import { registerSsoRoutes, setupSamlAuth } from "./sso";
import { registerMfaRoutes } from "./mfa";
import { registerABTestRoutes } from "./ab-testing";
import { registerSpendTrackingRoutes } from "./spend-tracking";
import { registerClinicalRoutes } from "./clinical";
import { registerEhrRoutes } from "./ehr";

export async function registerRoutes(app: Express): Promise<Server> {
  // API key auth middleware (before routes, after session middleware)
  app.use("/api", apiKeyAuth);

  // Set up Google OAuth if configured
  await setupGoogleOAuth();

  // Set up SAML SSO (per-org IDP configuration)
  await setupSamlAuth();

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerOAuthRoutes(app);
  registerSsoRoutes(app);
  registerRegistrationRoutes(app);
  registerPasswordResetRoutes(app);
  registerMfaRoutes(app);
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
  registerExportRoutes(app);
  registerABTestRoutes(app);
  registerSpendTrackingRoutes(app);
  registerClinicalRoutes(app);
  registerEhrRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}

import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  const loginLink = page.getByText(/sign in|log in|get started/i).first();
  if (await loginLink.isVisible()) {
    await loginLink.click();
  }

  const usernameInput = page.locator("input[type='text'], input[name='username']").first();
  await usernameInput.waitFor({ timeout: 5000 });
  await usernameInput.fill("admin");

  const passwordInput = page.locator("input[type='password']").first();
  await passwordInput.fill("admin123");

  const submitBtn = page.getByRole("button", { name: /sign in|log in|submit/i }).first();
  await submitBtn.click();

  await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 10000 });
}

test.describe("Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("sidebar contains expected navigation links", async ({ page }) => {
    await expect(page.locator("[data-testid='nav-link-dashboard']")).toBeVisible();
    await expect(page.locator("[data-testid='nav-link-upload-calls']")).toBeVisible();
    await expect(page.locator("[data-testid='nav-link-transcripts']")).toBeVisible();
    await expect(page.locator("[data-testid='nav-link-search']")).toBeVisible();
  });

  test("admin user can see admin links", async ({ page }) => {
    await expect(page.locator("[data-testid='nav-link-admin']")).toBeVisible();
    await expect(page.locator("[data-testid='nav-link-templates']")).toBeVisible();
    await expect(page.locator("[data-testid='nav-link-audit-logs']")).toBeVisible();
  });

  test("can navigate to upload page", async ({ page }) => {
    await page.locator("[data-testid='nav-link-upload-calls']").click();
    await expect(page).toHaveURL(/\/upload/);
  });

  test("can navigate to reports page", async ({ page }) => {
    await page.locator("[data-testid='nav-link-reports']").click();
    await expect(page).toHaveURL(/\/reports/);
  });

  test("can navigate to admin page", async ({ page }) => {
    await page.locator("[data-testid='nav-link-admin']").click();
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.locator("[data-testid='admin-page']")).toBeVisible();
  });

  test("can navigate to audit logs page", async ({ page }) => {
    await page.locator("[data-testid='nav-link-audit-logs']").click();
    await expect(page).toHaveURL(/\/admin\/audit-logs/);
    await expect(page.locator("[data-testid='audit-logs-page']")).toBeVisible();
  });

  test("can logout", async ({ page }) => {
    await page.locator("[data-testid='logout-button']").click();
    // After logout, should see landing page or login
    await expect(page.locator("[data-testid='sidebar']")).not.toBeVisible({ timeout: 5000 });
  });
});

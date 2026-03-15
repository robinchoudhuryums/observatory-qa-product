import { test, expect, type Page } from "@playwright/test";

async function loginAs(page: Page, username: string, password: string) {
  await page.goto("/");
  const loginLink = page.getByText(/sign in|log in|get started/i).first();
  if (await loginLink.isVisible()) {
    await loginLink.click();
  }

  const usernameInput = page.locator("input[type='text'], input[name='username']").first();
  await usernameInput.waitFor({ timeout: 5000 });
  await usernameInput.fill(username);

  const passwordInput = page.locator("input[type='password']").first();
  await passwordInput.fill(password);

  const submitBtn = page.getByRole("button", { name: /sign in|log in|submit/i }).first();
  await submitBtn.click();

  await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 10000 });
}

test.describe("RBAC - Role-Based Access Control", () => {
  test("viewer cannot see admin links", async ({ page }) => {
    await loginAs(page, "viewer", "viewer123");
    await expect(page.locator("[data-testid='nav-link-admin']")).not.toBeVisible();
    await expect(page.locator("[data-testid='nav-link-templates']")).not.toBeVisible();
    await expect(page.locator("[data-testid='nav-link-audit-logs']")).not.toBeVisible();
  });

  test("viewer cannot access admin page directly", async ({ page }) => {
    await loginAs(page, "viewer", "viewer123");
    await page.goto("/admin");
    // Should see permission denied message
    await expect(page.getByText(/don't have permission/i)).toBeVisible({ timeout: 5000 });
  });

  test("viewer cannot access audit logs directly", async ({ page }) => {
    await loginAs(page, "viewer", "viewer123");
    await page.goto("/admin/audit-logs");
    await expect(page.getByText(/don't have permission/i)).toBeVisible({ timeout: 5000 });
  });

  test("admin can access admin page", async ({ page }) => {
    await loginAs(page, "admin", "admin123");
    await page.goto("/admin");
    await expect(page.locator("[data-testid='admin-page']")).toBeVisible({ timeout: 5000 });
  });
});

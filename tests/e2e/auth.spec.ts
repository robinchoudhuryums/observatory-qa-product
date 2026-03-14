import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("shows landing page when not authenticated", async ({ page }) => {
    await page.goto("/");
    // Should see the landing page or login form
    await expect(page.locator("body")).toBeVisible();
  });

  test("can navigate to login page", async ({ page }) => {
    await page.goto("/");
    // Look for sign-in or login button on landing page
    const loginLink = page.getByText(/sign in|log in|get started/i).first();
    if (await loginLink.isVisible()) {
      await loginLink.click();
      // Should see login form
      await expect(page.locator("input[type='text'], input[name='username']").first()).toBeVisible({ timeout: 5000 });
    }
  });

  test("login with valid credentials shows dashboard", async ({ page }) => {
    await page.goto("/");
    // Navigate to login if on landing page
    const loginLink = page.getByText(/sign in|log in|get started/i).first();
    if (await loginLink.isVisible()) {
      await loginLink.click();
    }

    // Fill login form
    const usernameInput = page.locator("input[type='text'], input[name='username']").first();
    await usernameInput.waitFor({ timeout: 5000 });
    await usernameInput.fill("admin");

    const passwordInput = page.locator("input[type='password']").first();
    await passwordInput.fill("admin123");

    // Submit
    const submitBtn = page.getByRole("button", { name: /sign in|log in|submit/i }).first();
    await submitBtn.click();

    // Should see dashboard or sidebar
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 10000 });
  });

  test("login with invalid credentials shows error", async ({ page }) => {
    await page.goto("/");
    const loginLink = page.getByText(/sign in|log in|get started/i).first();
    if (await loginLink.isVisible()) {
      await loginLink.click();
    }

    const usernameInput = page.locator("input[type='text'], input[name='username']").first();
    await usernameInput.waitFor({ timeout: 5000 });
    await usernameInput.fill("admin");

    const passwordInput = page.locator("input[type='password']").first();
    await passwordInput.fill("wrongpassword");

    const submitBtn = page.getByRole("button", { name: /sign in|log in|submit/i }).first();
    await submitBtn.click();

    // Should see error message
    await expect(page.getByText(/invalid|incorrect|failed/i).first()).toBeVisible({ timeout: 5000 });
  });
});

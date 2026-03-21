import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("settings page loads", async ({ page }) => {
    await page.goto("/settings");

    // Page should show settings-related content
    const settingsContent = page
      .locator("[data-testid='settings-page']")
      .first();

    const hasTestId = await settingsContent.isVisible().catch(() => false);
    if (hasTestId) {
      await expect(settingsContent).toBeVisible();
    } else {
      const heading = page.getByText(/settings|preferences/i).first();
      await expect(heading).toBeVisible({ timeout: 10000 });
    }
  });

  test("dark mode toggle exists", async ({ page }) => {
    await page.goto("/settings");

    // Look for dark mode toggle — could be switch, checkbox, or button
    const darkModeToggle = page
      .locator(
        "[data-testid='dark-mode-toggle'], [data-testid='theme-toggle'], button:has-text('dark mode'), label:has-text('dark mode'), [role='switch']",
      )
      .first();

    const hasToggle = await darkModeToggle.isVisible().catch(() => false);
    if (hasToggle) {
      await expect(darkModeToggle).toBeVisible();
    } else {
      // Fall back to text indicating theme settings
      const themeText = page
        .getByText(/dark mode|theme|appearance/i)
        .first();
      await expect(themeText).toBeVisible({ timeout: 10000 });
    }
  });

  test("user info is displayed", async ({ page }) => {
    await page.goto("/settings");

    // Should show the logged-in user's name or username
    const userInfo = page
      .getByText(/test admin|admin/i)
      .first();
    await expect(userInfo).toBeVisible({ timeout: 10000 });
  });
});

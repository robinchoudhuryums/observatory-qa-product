import { expect, type Page } from "@playwright/test";

/**
 * Log in as a specific user. Navigates to the landing page, clicks through
 * to the login form, fills credentials, submits, and waits for the sidebar
 * to confirm a successful authenticated session.
 */
export async function login(
  page: Page,
  username = "admin",
  password = "admin123",
) {
  await page.goto("/");
  const loginLink = page.getByText(/sign in|log in|get started/i).first();
  if (await loginLink.isVisible()) {
    await loginLink.click();
  }

  const usernameInput = page
    .locator("input[type='text'], input[name='username']")
    .first();
  await usernameInput.waitFor({ timeout: 5000 });
  await usernameInput.fill(username);

  const passwordInput = page.locator("input[type='password']").first();
  await passwordInput.fill(password);

  const submitBtn = page
    .getByRole("button", { name: /sign in|log in|submit/i })
    .first();
  await submitBtn.click();

  await expect(page.locator("[data-testid='sidebar']")).toBeVisible({
    timeout: 10000,
  });
}

import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Search Flow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("search page loads", async ({ page }) => {
    await page.locator("[data-testid='nav-link-search']").click();
    await expect(page).toHaveURL(/\/search/);
  });

  test("search input is visible", async ({ page }) => {
    await page.goto("/search");

    const searchInput = page
      .locator(
        "[data-testid='search-input'], input[placeholder*='search' i], input[type='search'], input[name='search'], input[name='query']",
      )
      .first();
    await expect(searchInput).toBeVisible({ timeout: 10000 });
  });

  test("can type a search query", async ({ page }) => {
    await page.goto("/search");

    const searchInput = page
      .locator(
        "[data-testid='search-input'], input[placeholder*='search' i], input[type='search'], input[name='search'], input[name='query']",
      )
      .first();
    await searchInput.waitFor({ timeout: 10000 });
    await searchInput.fill("test query");
    await expect(searchInput).toHaveValue("test query");
  });

  test("results area is visible", async ({ page }) => {
    await page.goto("/search");

    // The results/content area should exist (may show empty state or placeholder)
    const resultsArea = page
      .locator(
        "[data-testid='search-results'], [data-testid='results-area'], [role='list']",
      )
      .first();

    const hasResultsArea = await resultsArea.isVisible().catch(() => false);
    if (hasResultsArea) {
      await expect(resultsArea).toBeVisible();
    } else {
      // Look for empty-state text that indicates where results would appear
      const emptyState = page
        .getByText(/no results|no calls|search for|enter a query|start searching/i)
        .first();
      await expect(emptyState).toBeVisible({ timeout: 10000 });
    }
  });
});

import { test, expect } from "@playwright/test";

test.describe("API Health Tests", () => {
  test("GET /api/health returns 200", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);

    const body = await response.json();
    // Health endpoint should return some status indication
    expect(body).toBeDefined();
  });

  test("GET /api/auth/me without auth returns 401", async ({ request }) => {
    const response = await request.get("/api/auth/me");
    expect(response.status()).toBe(401);
  });

  test("POST /api/auth/login with bad credentials returns 401", async ({
    request,
  }) => {
    const response = await request.post("/api/auth/login", {
      data: {
        username: "admin",
        password: "wrongpassword",
      },
    });
    expect(response.status()).toBe(401);
  });

  test("POST /api/auth/login with good credentials returns 200", async ({
    request,
  }) => {
    const response = await request.post("/api/auth/login", {
      data: {
        username: "admin",
        password: "admin123",
      },
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toBeDefined();
    // Should return user info on successful login
    expect(body.username || body.user?.username || body.name).toBeDefined();
  });
});

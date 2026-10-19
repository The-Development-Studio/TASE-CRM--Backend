import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.SERVER_PORT = "3999";
process.env.CLIENT_ORIGIN = "http://localhost:8443";
process.env.MONGODB_URI = "replace_me";
process.env.STAFF_ADMIN_KEY = "replace_me";
process.env.RESEND_API_KEY = "replace_me";
process.env.RESEND_FROM_EMAIL = "TDS CRM <crm@example.com>";
process.env.RESEND_WEBHOOK_SECRET = "replace_me";
process.env.R2_ACCOUNT_ID = "replace_me";
process.env.R2_ACCESS_KEY_ID = "replace_me";
process.env.R2_SECRET_ACCESS_KEY = "replace_me";
process.env.R2_BUCKET = "replace_me";

const { app } = await import("../dist/app.js");

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not determine the API test port"));
        return;
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
    server.on("error", reject);
  });
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("health endpoint reports missing optional test integrations", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, "configuration-required");
  assert.equal(result.database, "not-configured");
  assert.equal(result.resend, "not-configured");
  assert.equal(result.documents, "not-configured");
  assert.equal(Number.isInteger(result.responseTimeMs), true);
});

test("CRM resources reject unauthenticated requests", async () => {
  const response = await fetch(`${baseUrl}/api/customers`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Staff sign-in required" });
});

test("unknown public routes return JSON 404 responses", async () => {
  const response = await fetch(`${baseUrl}/not-found`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Route not found" });
});

test("CORS permits the configured frontend origin", async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "http://localhost:8443" }
  });
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:8443");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
});

test("staff password reset request validates the email address", async () => {
  const response = await fetch(`${baseUrl}/api/staff-auth/request-password-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "not-an-email" })
  });
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.equal(result.error, "Validation failed");
  assert.match(result.details.fieldErrors.email[0], /email/i);
});

test("staff password reset rejects malformed tokens", async () => {
  const response = await fetch(`${baseUrl}/api/staff-auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "too-short", password: "a-secure-new-password" })
  });
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.equal(result.error, "Validation failed");
  assert.match(result.details.fieldErrors.token[0], /32/);
});

test("staff profile updates require authentication", async () => {
  const response = await fetch(`${baseUrl}/api/staff-auth/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test User", jobTitle: "Sales Manager", department: "Sales", phone: "" })
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Staff sign-in required" });
});

test("staff page access management requires an administrator", async () => {
  const response = await fetch(`${baseUrl}/api/staff-auth/users`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Staff sign-in required" });
});

test("lead assignee directory requires lead access", async () => {
  const response = await fetch(`${baseUrl}/api/staff-auth/assignees`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Staff sign-in required" });
});

test("staff account activation requires an administrator", async () => {
  const response = await fetch(`${baseUrl}/api/staff-auth/users/507f1f77bcf86cd799439011/active`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: false })
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Staff sign-in required" });
});

test("production startup rejects a missing Resend webhook secret", () => {
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    "import('./Backend/dist/config.js')"
  ], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      MONGODB_URI: "mongodb://localhost:27017/tds_crm",
      STAFF_ADMIN_KEY: "0123456789abcdef0123456789abcdef",
      CLIENT_ORIGIN: "https://crm.example.com",
      RESEND_API_KEY: "re_test_key",
      RESEND_FROM_EMAIL: "TDS CRM <crm@example.com>",
      RESEND_WEBHOOK_SECRET: "replace_me",
      R2_ACCOUNT_ID: "test-account",
      R2_ACCESS_KEY_ID: "test-access-key",
      R2_SECRET_ACCESS_KEY: "test-secret-key",
      R2_BUCKET: "test-bucket"
    }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RESEND_WEBHOOK_SECRET/);
});

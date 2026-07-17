import type { XeCmsServer } from "./server.js";

export const TEST_OWNER_USERNAME = "admin";
export const TEST_OWNER_PASSWORD = "Admin-test-only-2026!";

export async function bootstrapTestOwner(
  server: XeCmsServer,
  username = TEST_OWNER_USERNAME,
  password = TEST_OWNER_PASSWORD,
): Promise<void> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/bootstrap",
    payload: { username, password },
  });

  if (response.statusCode !== 201) {
    throw new Error(
      `Test owner bootstrap failed (${response.statusCode}): ${response.body}`,
    );
  }
}

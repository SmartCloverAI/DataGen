import { NextRequest } from "next/server";

import {
  createSessionToken,
  parseSessionToken,
  SESSION_COOKIE,
} from "@/lib/auth/session";
import {
  requireAuthFromRequest,
  UnauthorizedError,
} from "@/lib/auth/requireAuth";

beforeAll(() => {
  process.env.DATAGEN_SESSION_SECRET = "test-secret";
});

describe("session + auth guard", () => {
  it("creates and parses a session token", () => {
    const token = createSessionToken({ username: "alice", role: "admin" });
    const parsed = parseSessionToken(token);
    expect(parsed).toMatchObject({ username: "alice", role: "admin" });
  });

  it("authenticates when the session cookie is present", () => {
    const token = createSessionToken({ username: "bob", role: "user" });
    const request = new NextRequest(new URL("http://localhost/test"), {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });

    const session = requireAuthFromRequest(request);
    expect(session.username).toBe("bob");
    expect(session.role).toBe("user");
  });

  it("throws UnauthorizedError when cookie is missing", () => {
    const request = new NextRequest(new URL("http://localhost/no-cookie"));
    expect(() => requireAuthFromRequest(request)).toThrow(UnauthorizedError);
  });
});

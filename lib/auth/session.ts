import { cookies as nextCookies } from "next/headers";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { SignOptions, verify, sign } from "jsonwebtoken";
import { serialize } from "cookie";

import { requiredEnv } from "@/lib/env";

export type SessionUser = {
  username: string;
  role: string;
};

export const SESSION_COOKIE = "datagen_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function sessionSecret() {
  return requiredEnv("DATAGEN_SESSION_SECRET");
}

export function createSessionToken(user: SessionUser, opts?: SignOptions) {
  return sign(user, sessionSecret(), {
    expiresIn: SESSION_TTL_SECONDS,
    ...opts,
  });
}

export function parseSessionToken(token: string | undefined | null) {
  if (!token) return null;
  try {
    return verify(token, sessionSecret()) as SessionUser;
  } catch {
    return null;
  }
}

export function createSessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production";
  return serialize(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production";
  return serialize(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: 0,
  });
}

export async function getSessionFromCookies(
  cookieStore: ReadonlyRequestCookies | Promise<ReadonlyRequestCookies> = nextCookies(),
): Promise<SessionUser | null> {
  const store = await cookieStore;
  const token = store.get(SESSION_COOKIE)?.value;
  return parseSessionToken(token);
}

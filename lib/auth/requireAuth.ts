import { NextRequest } from "next/server";

import { parseSessionToken, SESSION_COOKIE, SessionUser } from "./session";

export class UnauthorizedError extends Error {
  status: number;
  constructor(message = "Unauthorized") {
    super(message);
    this.status = 401;
  }
}

export function requireAuthFromRequest(request: NextRequest): SessionUser {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = parseSessionToken(token);
  if (!session) {
    throw new UnauthorizedError();
  }
  return session;
}

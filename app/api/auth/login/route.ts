import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createSessionCookie, createSessionToken } from "@/lib/auth/session";
import { ensureAuthInitialized } from "@/lib/ratio1/auth";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { username, password } = parsed.data;

  try {
    const auth = await ensureAuthInitialized();
    const user = await auth.simple.authenticate(username, password);
    const token = createSessionToken({
      username: user.username,
      role: (user as { role?: string }).role ?? "user",
    });

    const response = NextResponse.json({
      username: user.username,
      role: (user as { role?: string }).role ?? "user",
    });
    response.headers.append("Set-Cookie", createSessionCookie(token));
    return response;
  } catch (error) {
    console.error("Login failed", error);
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 },
    );
  }
}

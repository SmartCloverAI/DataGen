import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createSessionCookie, createSessionToken } from "@/lib/auth/session";
import { ensureAuthInitialized } from "@/lib/ratio1/auth";

export const runtime = "nodejs";

const registrationSchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(8),
});

function isUserExists(error: unknown) {
  const name = (error as any)?.name;
  const code = (error as any)?.code;
  const message = (error as any)?.message ?? "";
  if (name === "UserExistsError") return true;
  if (typeof code === "string" && code.toUpperCase().includes("EXIST")) return true;
  if (typeof message === "string" && message.toLowerCase().includes("exists")) return true;
  return false;
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const parsed = registrationSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { username, password } = parsed.data;

  try {
    const auth = await ensureAuthInitialized();
    const user = await auth.simple.createUser(username, password, { role: "user" });
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
    if (isUserExists(error)) {
      return NextResponse.json({ error: "User already exists" }, { status: 409 });
    }
    console.error("Registration failed", error);
    return NextResponse.json(
      { error: "Unable to create account" },
      { status: 400 },
    );
  }
}

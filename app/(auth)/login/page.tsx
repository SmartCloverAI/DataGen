"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupUsername, setSignupUsername] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (response.ok) {
      router.push("/");
      router.refresh();
      return;
    }

    const data = await response.json().catch(() => null);
    setError(data?.error ?? "Login failed");
    setLoading(false);
  };

  const handleSignup = async (event: FormEvent) => {
    event.preventDefault();
    setSignupLoading(true);
    setSignupError(null);
    setSignupSuccess(null);

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: signupUsername,
        password: signupPassword,
      }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setSignupError(data?.error ?? "Could not create account");
      setSignupLoading(false);
      return;
    }

    setSignupSuccess("Account created. Redirecting...");
    setSignupLoading(false);
    router.push("/");
    router.refresh();
  };

  return (
    <main className="page">
      <section className="panel">
        <header className="panel__header">
          <div>
            <p className="eyebrow">DataGen</p>
            <h1>Sign in</h1>
            <p className="muted">
              Use your cstore-auth credentials to access the DataGen dashboard.
            </p>
          </div>
        </header>

        <form className="form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Username</span>
            <input
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error ? <p className="error">{error}</p> : null}

          <button className="button" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="panel__body">
          <h2>Create an account</h2>
          <p className="muted">
            New here? Create your own account. You’ll be signed in automatically after
            signup.
          </p>
          <form className="form" onSubmit={handleSignup}>
            <label className="field">
              <span>Username</span>
              <input
                name="signup-username"
                autoComplete="username"
                value={signupUsername}
                minLength={3}
                maxLength={64}
                onChange={(e) => setSignupUsername(e.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                name="signup-password"
                type="password"
                autoComplete="new-password"
                value={signupPassword}
                minLength={8}
                onChange={(e) => setSignupPassword(e.target.value)}
                required
              />
            </label>

            {signupError ? <p className="error">{signupError}</p> : null}
            {signupSuccess ? <p className="muted">{signupSuccess}</p> : null}

            <button className="button button--ghost" type="submit" disabled={signupLoading}>
              {signupLoading ? "Creating..." : "Create account"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

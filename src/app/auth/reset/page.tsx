"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Globe } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Mode = "request" | "reset" | "done";

export default function ResetPasswordPage() {
  const [mode, setMode] = useState<Mode>("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) {
      setError("This password reset link is invalid or expired. Request a new one below.");
      return;
    }
    if (!code) return;

    let mounted = true;
    const supabase = createClient();
    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (!mounted) return;
      if (error) {
        setError("This password reset link is invalid or expired. Request a new one below.");
        setMode("request");
      } else {
        setMode("reset");
        setMessage("Choose a new password for your account.");
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/auth/password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(body.error || "Could not request a password reset. Try again.");
      return;
    }
    setMode("done");
    setMessage("If that account exists, a reset email has been sent. Check inbox and spam.");
  }

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      setLoading(false);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    window.location.href = "/app";
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-4">
            <Globe className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold">PresenceOS</span>
          </Link>
          <p className="text-muted-foreground">Reset your password</p>
        </div>

        <form onSubmit={mode === "reset" ? updatePassword : requestReset} className="bg-card border border-border rounded-xl p-6 space-y-4">
          {error && <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg">{error}</div>}
          {message && <div className="bg-primary/10 text-primary text-sm p-3 rounded-lg">{message}</div>}

          {mode === "reset" ? (
            <>
              <div>
                <label htmlFor="reset-new-password" className="block text-sm font-medium mb-1.5">New password</label>
                <input
                  id="reset-new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>
              <div>
                <label htmlFor="reset-confirm-password" className="block text-sm font-medium mb-1.5">Confirm password</label>
                <input
                  id="reset-confirm-password"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  minLength={8}
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50">
                {loading ? "Updating..." : "Update password"}
              </button>
            </>
          ) : (
            <>
              <div>
                <label htmlFor="reset-email" className="block text-sm font-medium mb-1.5">Email</label>
                <input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>
              <button type="submit" disabled={loading || mode === "done"} className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50">
                {loading ? "Sending..." : "Send reset email"}
              </button>
            </>
          )}

          <p className="text-center text-sm text-muted-foreground">
            Remember your password?{" "}
            <Link href="/login" className="text-primary hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

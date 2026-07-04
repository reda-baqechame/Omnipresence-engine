"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Globe } from "lucide-react";

const CALLBACK_ERROR_MSG =
  "Email confirmation link expired or invalid. Sign in after confirming your email.";
const RESET_SUCCESS_MSG = "Password updated. You can sign in with your new password.";

function subscribeToUrl() {
  return () => {};
}

function readAuthCallbackError(): string {
  const params = new URLSearchParams(window.location.search);
  const err = params.get("error");
  if (params.get("reset") === "success") return RESET_SUCCESS_MSG;
  return err === "auth_callback" ? CALLBACK_ERROR_MSG : "";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);
  const callbackError = useSyncExternalStore(subscribeToUrl, readAuthCallbackError, () => "");
  const error = formError || callbackError;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setFormError("");

    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      const msg =
        error.message.toLowerCase().includes("email not confirmed")
          ? "Confirm your email first (check inbox/spam), then sign in."
          : error.message;
      setFormError(msg);
      setLoading(false);
    } else {
      const meta = data.user?.user_metadata as { pending_org_name?: string; full_name?: string } | undefined;
      const pendingOrg =
        sessionStorage.getItem("pending_org_name") ||
        meta?.pending_org_name?.trim() ||
        (meta?.full_name ? `${meta.full_name}'s Agency` : "");

      if (pendingOrg) {
        const res = await fetch("/api/auth/setup-org", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgName: pendingOrg }),
        });
        sessionStorage.removeItem("pending_org_name");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (body.error !== "Organization already exists for this user") {
            setFormError(body.error || "Signed in but organization setup failed. Use the banner on the dashboard.");
            setLoading(false);
            window.location.href = "/app?setup=failed";
            return;
          }
        }
      }
      window.location.href = "/app";
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-4">
            <Globe className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold">PresenceOS</span>
          </Link>
          <p className="text-muted-foreground">Sign in to your account</p>
        </div>

        <form onSubmit={handleLogin} className="bg-card border border-border rounded-xl p-6 space-y-4">
          {error && <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg">{error}</div>}

          <div>
            <label htmlFor="login-email" className="block text-sm font-medium mb-1.5">Email</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium mb-1.5">Password</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <div className="text-center">
            <Link href="/auth/reset" className="text-sm text-primary hover:underline">
              Forgot password?
            </Link>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-primary hover:underline">Sign up</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

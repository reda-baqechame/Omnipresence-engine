"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Globe } from "lucide-react";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [existingAccount, setExistingAccount] = useState(false);
  const [loading, setLoading] = useState(false);

  async function setupOrganization(name: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch("/api/auth/setup-org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName: name }),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    if (body.error === "Organization already exists for this user") return { ok: true };
    return { ok: false, error: body.error || `Setup failed (${res.status})` };
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setInfo("");
    setExistingAccount(false);

    const supabase = createClient();
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (typeof window !== "undefined" ? window.location.origin : "");
    const organizationName = orgName.trim() || `${fullName}'s Agency`;

    const regRes = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        fullName,
        orgName: organizationName,
      }),
    });
    const regJson = await regRes.json().catch(() => ({}));

    if (regRes.ok && regJson.ok) {
      if (regJson.needsLogin) {
        setInfo(regJson.message || "Account created. Please sign in.");
        setLoading(false);
        return;
      }
      setInfo("Account ready — redirecting to your dashboard…");
      window.location.href = "/app";
      return;
    }

    if (regRes.status === 429) {
      setError(regJson.error || "Too many signup attempts. Please wait an hour and try again.");
      setLoading(false);
      return;
    }

    if (regRes.status !== 404 && regRes.status !== 501) {
      const msg = regJson.error || "Registration failed. Try again or sign in if you already have an account.";
      setExistingAccount(/already exists|already registered|signing in/i.test(msg));
      setError(msg);
      setLoading(false);
      return;
    }

    // Fallback: client-side signUp if register route unavailable
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, pending_org_name: organizationName },
        emailRedirectTo: `${appUrl}/auth/callback?next=/app`,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    if (data.session) {
      const setup = await setupOrganization(organizationName);
      if (!setup.ok) {
        setError(setup.error || "Account created but organization setup failed. Try again from the dashboard.");
        setLoading(false);
        window.location.href = "/app?setup=failed";
        return;
      }
      setInfo("Account ready — redirecting to your dashboard…");
      window.location.href = "/app";
      return;
    }

    if (data.user) {
      setInfo(
        "Check your email to confirm your account. After confirming, sign in — your organization will be set up automatically. If you don't receive an email within a few minutes, try signing in directly (instant signup may already be enabled)."
      );
      sessionStorage.setItem("pending_org_name", organizationName);
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-4">
            <Globe className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold">PresenceOS</span>
          </Link>
          <p className="text-muted-foreground">Create your account</p>
        </div>

        <form onSubmit={handleSignup} className="bg-card border border-border rounded-xl p-6 space-y-4">
          {error && <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg">{error}</div>}
          {existingAccount && (
            <div className="bg-primary/10 text-primary text-sm p-3 rounded-lg">
              This email already has an account.{" "}
              <Link href="/login" className="underline">Sign in</Link>
              {" "}or{" "}
              <Link href="/auth/reset" className="underline">reset your password</Link>.
            </div>
          )}
          {info && <div className="bg-primary/10 text-primary text-sm p-3 rounded-lg">{info}</div>}

          <div>
            <label htmlFor="signup-full-name" className="block text-sm font-medium mb-1.5">Full Name</label>
            <input id="signup-full-name" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" required />
          </div>

          <div>
            <label htmlFor="signup-org-name" className="block text-sm font-medium mb-1.5">Organization Name</label>
            <input id="signup-org-name" type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Your agency or company name"
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>

          <div>
            <label htmlFor="signup-email" className="block text-sm font-medium mb-1.5">Email</label>
            <input id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" required />
          </div>

          <div>
            <label htmlFor="signup-password" className="block text-sm font-medium mb-1.5">Password</label>
            <input id="signup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8}
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" required />
          </div>

          <button type="submit" disabled={loading}
            className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50">
            {loading ? "Creating account..." : "Create Account"}
          </button>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

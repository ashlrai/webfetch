"use client";

import { Icon } from "@/components/Icon";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL ?? "https://getwebfetch.com";

export default function SignupPage() {
  const searchParams = useSearchParams();
  const plan = searchParams.get("plan");
  const validPlan = plan === "pro" || plan === "team" ? plan : null;
  const callbackURL = validPlan ? `/billing/checkout?plan=${validPlan}` : "/";

  const [agreed, setAgreed] = useState(false);
  const [showConsentError, setShowConsentError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    if (!agreed) {
      e.preventDefault();
      setShowConsentError(true);
    }
  }

  function handleOAuth(e: React.MouseEvent) {
    if (!agreed) {
      e.preventDefault();
      setShowConsentError(true);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[24px] font-medium tracking-tight">Create an account</h1>
        <p className="text-[13px]" style={{ color: "var(--text-dim)" }}>
          Free tier includes 100 fetches/day. No credit card required.
        </p>
      </div>

      <form
        action="/api/proxy/auth/sign-up/email"
        method="post"
        className="surface p-5 flex flex-col gap-3"
        onSubmit={handleSubmit}
      >
        <input type="hidden" name="callbackURL" value={callbackURL} />
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Name</span>
          <input type="text" name="name" className="input" required autoComplete="name" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Work email</span>
          <input type="email" name="email" className="input" required autoComplete="email" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Password</span>
          <input
            type="password"
            name="password"
            className="input"
            required
            minLength={8}
            autoComplete="new-password"
          />
          <span className="text-[11px] mono" style={{ color: "var(--text-mute)" }}>
            8+ characters
          </span>
        </label>
        <button type="submit" className="btn btn-primary btn-lg" disabled={!agreed}>
          Create account
        </button>
      </form>

      <div
        className="flex items-center gap-3 text-[11px] mono"
        style={{ color: "var(--text-mute)" }}
      >
        <div className="rule flex-1" /> OR <div className="rule flex-1" />
      </div>

      <div className="flex flex-col gap-2">
        <a
          href={`/api/proxy/auth/sign-in/social?provider=google&callbackURL=${encodeURIComponent(callbackURL)}`}
          className={`btn btn-lg${!agreed ? " opacity-50 pointer-events-none" : ""}`}
          aria-disabled={!agreed}
          onClick={handleOAuth}
        >
          <Icon name="external" /> Continue with Google
        </a>
        <a
          href={`/api/proxy/auth/sign-in/social?provider=github&callbackURL=${encodeURIComponent(callbackURL)}`}
          className={`btn btn-lg${!agreed ? " opacity-50 pointer-events-none" : ""}`}
          aria-disabled={!agreed}
          onClick={handleOAuth}
        >
          <Icon name="external" /> Continue with GitHub
        </a>
      </div>

      {/* Terms + Privacy consent */}
      <label className="flex items-start gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => {
            setAgreed(e.target.checked);
            if (e.target.checked) setShowConsentError(false);
          }}
          className="mt-0.5 shrink-0"
        />
        <span className="text-[12.5px]" style={{ color: "var(--text-dim)" }}>
          I agree to the{" "}
          <a
            href={`${LANDING_URL}/legal/terms`}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:underline"
            style={{ color: "var(--accent)" }}
          >
            Terms of Service
          </a>{" "}
          and{" "}
          <a
            href={`${LANDING_URL}/legal/privacy`}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:underline"
            style={{ color: "var(--accent)" }}
          >
            Privacy Policy
          </a>
          .
        </span>
      </label>
      {showConsentError && (
        <p className="text-[12px] mono" style={{ color: "var(--danger)" }}>
          Please agree to the Terms of Service and Privacy Policy to continue.
        </p>
      )}

      <ul className="flex flex-col gap-2 text-[12.5px]" style={{ color: "var(--text-dim)" }}>
        {[
          "100 fetches/day on the free tier",
          "License-default providers — Unsplash, Pexels, Wikimedia, Europeana",
          "CLI, MCP server, and VS Code extension on the same key",
        ].map((l) => (
          <li key={l} className="flex items-center gap-2">
            <Icon name="check" size={12} style={{ color: "var(--ok)" }} /> {l}
          </li>
        ))}
      </ul>

      <p className="text-[12.5px] text-center" style={{ color: "var(--text-dim)" }}>
        Already have an account?{" "}
        <Link href="/login" className="hover:underline" style={{ color: "var(--accent)" }}>
          Sign in
        </Link>
      </p>
    </div>
  );
}

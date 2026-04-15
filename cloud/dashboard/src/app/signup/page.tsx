import { Icon } from "@/components/Icon";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function SignupPage() {
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
      >
        <input type="hidden" name="callbackURL" value="/" />
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
        <button type="submit" className="btn btn-primary btn-lg">
          Create account
        </button>
      </form>

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

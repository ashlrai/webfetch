import { Icon } from "@/components/Icon";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[24px] font-medium tracking-tight">Sign in</h1>
        <p className="text-[13px]" style={{ color: "var(--text-dim)" }}>
          Use the same account you use for the CLI and MCP server.
        </p>
      </div>

      <form
        action="/api/proxy/auth/sign-in/email"
        method="post"
        className="surface p-5 flex flex-col gap-3"
      >
        <input type="hidden" name="callbackURL" value="/" />
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Email</span>
          <input type="email" name="email" className="input" required autoComplete="email" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow flex items-center justify-between">
            <span>Password</span>
            <Link
              href="/login?reset=1"
              className="text-[11px] normal-case tracking-normal"
              style={{ color: "var(--accent)", letterSpacing: 0 }}
            >
              Forgot?
            </Link>
          </span>
          <input
            type="password"
            name="password"
            className="input"
            required
            autoComplete="current-password"
          />
        </label>
        <button type="submit" className="btn btn-primary btn-lg">
          Sign in
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
          href="/api/proxy/auth/sign-in/social?provider=google&callbackURL=/"
          className="btn btn-lg"
        >
          <Icon name="external" /> Continue with Google
        </a>
        <a
          href="/api/proxy/auth/sign-in/social?provider=github&callbackURL=/"
          className="btn btn-lg"
        >
          <Icon name="external" /> Continue with GitHub
        </a>
      </div>

      <p className="text-[12.5px] text-center" style={{ color: "var(--text-dim)" }}>
        New here?{" "}
        <Link href="/signup" className="hover:underline" style={{ color: "var(--accent)" }}>
          Create an account
        </Link>
      </p>
    </div>
  );
}

import Link from "next/link";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-md flex flex-col gap-6 pt-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium tracking-tight">Create your webfetch account</h1>
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>
          Free tier includes 100 fetches/day. No credit card required.
        </p>
      </div>

      <form action="/api/proxy/v1/auth/signup" method="post" className="card p-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            Name
          </span>
          <input type="text" name="name" className="input" required autoComplete="name" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            Work email
          </span>
          <input type="email" name="email" className="input" required autoComplete="email" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            Password
          </span>
          <input type="password" name="password" className="input" required minLength={8} autoComplete="new-password" />
          <span className="text-[11px] mono" style={{ color: "var(--text-mute)" }}>
            8+ characters
          </span>
        </label>
        <button type="submit" className="btn btn-primary">
          Create account
        </button>
      </form>

      <p className="text-xs text-center" style={{ color: "var(--text-dim)" }}>
        Already have an account?{" "}
        <Link href="/login" className="hover:underline" style={{ color: "var(--accent)" }}>
          Sign in
        </Link>
      </p>
    </div>
  );
}

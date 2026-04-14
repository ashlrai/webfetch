import Link from "next/link";

export const dynamic = "force-dynamic";

export default function LoginPage({
  searchParams: _searchParams,
}: {
  searchParams?: Promise<{ redirect?: string }>;
}) {
  return (
    <div className="mx-auto max-w-md flex flex-col gap-6 pt-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium tracking-tight">Sign in to webfetch</h1>
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>
          Use the same account you use for the CLI and MCP server.
        </p>
      </div>

      <form action="/api/proxy/v1/auth/signin" method="post" className="card p-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            Email
          </span>
          <input type="email" name="email" className="input" required autoComplete="email" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            Password
          </span>
          <input type="password" name="password" className="input" required autoComplete="current-password" />
        </label>
        <button type="submit" className="btn btn-primary">
          Sign in
        </button>
      </form>

      <div className="flex flex-col gap-2">
        <button className="btn" formAction="/api/proxy/v1/auth/google">Continue with Google</button>
        <button className="btn" formAction="/api/proxy/v1/auth/github">Continue with GitHub</button>
      </div>

      <p className="text-xs text-center" style={{ color: "var(--text-dim)" }}>
        New here?{" "}
        <Link href="/signup" className="hover:underline" style={{ color: "var(--accent)" }}>
          Create an account
        </Link>
      </p>
    </div>
  );
}

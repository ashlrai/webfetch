import Shell from "@/components/Shell";
import { getOverview } from "@/lib/api";
import { getServerSession } from "@/lib/auth";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "webfetch · cloud",
  description: "Operational dashboard for the license-first image layer.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession().catch(() => null);
  let workspaces: { id: string; slug: string; name: string; plan?: string }[] = [];
  let activeSlug = "";
  let userLabel = "";
  let userEmail = "";
  if (session) {
    userLabel = session.user.name ?? session.user.email;
    userEmail = session.user.email;
    try {
      const overview = await getOverview();
      workspaces = overview.workspaces.map((w) => ({
        id: w.id,
        slug: w.slug,
        name: w.name,
        plan: w.plan,
      }));
      activeSlug = overview.workspace.slug;
    } catch {
      /* nav degrades to empty switcher */
    }
  }

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark`}>
      <body>
        <Shell
          workspaces={workspaces}
          activeSlug={activeSlug}
          authed={!!session}
          userLabel={userLabel}
          userEmail={userEmail}
        >
          {children}
        </Shell>
      </body>
    </html>
  );
}

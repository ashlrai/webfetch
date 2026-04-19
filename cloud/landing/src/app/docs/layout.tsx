import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DocsSearch } from "@/components/docs/DocsSearch";
import { DocsSidebar } from "@/components/docs/DocsSidebar";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "API reference, CLI guide, MCP setup, and provider docs for webfetch — the license-first image layer for AI agents.",
  alternates: { canonical: "/docs" },
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 lg:flex lg:gap-8">
      <div className="hidden lg:block w-64 shrink-0 sticky top-14 self-start h-[calc(100vh-3.5rem)] overflow-y-auto pt-8 pb-10">
        <div className="mb-5 px-1">
          <DocsSearch />
        </div>
        <nav aria-label="Docs navigation">
          <DocsSidebar />
        </nav>
      </div>
      <div className="min-w-0 flex-1 py-8 lg:py-10">{children}</div>
    </div>
  );
}

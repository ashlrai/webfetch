import { NextResponse } from "next/server";
import { buildSearchIndex } from "@/lib/docs";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(buildSearchIndex());
}

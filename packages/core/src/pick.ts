/**
 * Candidate ranking. MIRROR of factory's pick.ts with two additions:
 *   - respects `licensePolicy` (safe-only / prefer-safe / any)
 *   - folds `confidence` into the tie-break chain
 *
 * Decision order (license-first; see README LICENSE_POLICY):
 *   1. If policy is safe-only, reject anything not in SAFE_LICENSES.
 *   2. Lower LICENSE_RANK wins.
 *   3. Higher license confidence wins.
 *   4. Higher pixel count wins.
 *   5. Completeness (author/sourcePageUrl/title) wins.
 *   6. Stable index order.
 */

import { LICENSE_RANK, isSafeLicense } from "./license.ts";
import type { ImageCandidate, LicensePolicy } from "./types.ts";

export interface PickConstraints {
  minWidth?: number;
  minHeight?: number;
  requireSafeLicense?: boolean;
  licensePolicy?: LicensePolicy;
}

export function pickBest(
  candidates: readonly ImageCandidate[],
  constraints: PickConstraints = {},
): ImageCandidate | null {
  const ranked = rankAll(candidates, constraints);
  return ranked[0] ?? null;
}

export function rankAll(
  candidates: readonly ImageCandidate[],
  c: PickConstraints = {},
): ImageCandidate[] {
  const policy: LicensePolicy = c.licensePolicy ?? (c.requireSafeLicense === false ? "any" : "safe-only");
  const minW = c.minWidth ?? 0;
  const minH = c.minHeight ?? 0;

  type Scored = { cand: ImageCandidate; rank: number; pixels: number; complete: number; conf: number; idx: number };
  const scored: Scored[] = [];

  candidates.forEach((cand, idx) => {
    const safe = isSafeLicense(cand.license);
    if (policy === "safe-only" && !safe) return;
    const w = cand.width ?? 0;
    const h = cand.height ?? 0;
    if (w > 0 && w < minW) return;
    if (h > 0 && h < minH) return;

    scored.push({
      cand,
      rank: LICENSE_RANK[cand.license],
      pixels: w * h,
      complete:
        (cand.author ? 1 : 0) + (cand.sourcePageUrl ? 1 : 0) + (cand.title ? 1 : 0),
      conf: cand.confidence ?? (safe ? 0.5 : 0),
      idx,
    });
  });

  // For prefer-safe: stable-sort unsafe behind safe, but do not drop them.
  scored.sort((a, b) => {
    if (policy === "prefer-safe") {
      const aSafe = a.rank < 99 ? 0 : 1;
      const bSafe = b.rank < 99 ? 0 : 1;
      if (aSafe !== bSafe) return aSafe - bSafe;
    }
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.conf !== b.conf) return b.conf - a.conf;
    if (a.pixels !== b.pixels) return b.pixels - a.pixels;
    if (a.complete !== b.complete) return b.complete - a.complete;
    return a.idx - b.idx;
  });

  return scored.map((s, i) => ({
    ...s.cand,
    score: 1 / (i + 1), // simple monotonically decreasing score
  }));
}

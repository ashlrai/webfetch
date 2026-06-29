# webfetch Tuning Guide

Operational reference for diagnosing and improving perceptual-hash deduplication
quality across a federation run.

---

## pHash Diagnostics

webfetch uses two perceptual-hash algorithms:

| Algorithm | When used | Confidence |
|-----------|-----------|------------|
| `dct-phash` | `sharp` is installed and the image decodes successfully | `1.0` |
| `ahash-fallback` | `sharp` is unavailable or image decoding fails | `0.5` |

The `analyzePhashQuality` function produces a structured diagnostics report so
operators and agents can measure hash quality before trusting deduplication
decisions.

### Quick-start example

```ts
import { analyzePhashQuality } from "webfetch-core";
import { searchImages } from "webfetch-core";

const bundle = await searchImages("drake portrait", { licensePolicy: "safe-only" });
const diag = analyzePhashQuality(bundle.candidates);

console.log("Algorithm mix:     ", diag.algorithmMix);
// → "high-quality" | "degraded" | "fallback-heavy"

console.log("Dedupe reliability:", diag.dedupeReliability.toFixed(3));
// 0.0 (no DCT) … 1.0 (all DCT, full confidence)

if (diag.dedupeReliability < 0.5) {
  console.warn("Low pHash reliability — install `sharp` for DCT accuracy.");
}
```

### CLI usage

```sh
# Show diagnostics after a normal search
webfetch search "drake portrait" --phash-diagnostics

# Dedicated diagnostics command (JSON output for agents)
webfetch phash-diagnostics "drake portrait" --json

# Verbose mode also prints provider reports
webfetch phash-diagnostics "drake portrait" --verbose
```

### HTTP API

```
POST /analyze-phash-quality
Content-Type: application/json

{
  "candidates": [
    {
      "url": "https://example.com/img.jpg",
      "phash": "abcdef1234567890",
      "phashAlgorithm": "dct-phash",
      "phashResult": {
        "hash": "abcdef1234567890",
        "algorithm": "dct-phash",
        "confidence": 1.0
      }
    }
  ]
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "perAlgorithm": {
      "dct":   { "count": 1, "confidence": 1.0 },
      "ahash": { "count": 0, "confidence": 0   }
    },
    "algorithmMix": "high-quality",
    "confidenceDistribution": {
      "mean": 1.0, "min": 1.0, "max": 1.0, "stdDev": 0
    },
    "dedupeReliability": 1.0,
    "totalCandidates": 1,
    "hashedCount": 1,
    "unhashedCount": 0
  }
}
```

### Interpreting the report

#### `algorithmMix`

| Value | Condition | Meaning |
|-------|-----------|---------|
| `"high-quality"` | ≥ 90% of hashes used `dct-phash` | Deduplication is reliable |
| `"degraded"` | 10%–89% used `dct-phash` | Mixed quality; spot-check surprising merges |
| `"fallback-heavy"` | < 10% used `dct-phash` | `sharp` is likely missing; accuracy is significantly reduced |

#### `dedupeReliability`

Computed as `meanConfidence × dctRatio`.

| Range | Guidance |
|-------|----------|
| > 0.85 | Reliable — false-positive dedup unlikely |
| 0.5–0.85 | Moderate — consider spot-checking |
| < 0.5 | Low — disable perceptual dedup or fix `sharp` installation |

#### `confidenceDistribution`

`stdDev > 0` with `min` significantly below `mean` indicates that some providers
returned degraded or timed-out candidates. Check `providerReports` for timeout
entries and increase `timeoutMs` or remove slow providers.

### Improving pHash quality

1. **Install `sharp`** — the single biggest lever:
   ```sh
   npm install sharp   # or: bun add sharp
   ```

2. **Increase image timeout** — slow providers may time out before bytes are
   fetched, forcing the aHash fallback:
   ```sh
   webfetch search "query" --timeout-ms 30000
   ```

3. **Filter low-confidence candidates** — use `dedupeReliability < 0.5` as a
   signal to skip perceptual dedup entirely and fall back to URL-only dedup.

4. **Use `--providers`** — prefer providers known to return high-resolution
   images (wikimedia, unsplash, pexels) over browser/scraper providers that
   return compressed thumbnails.

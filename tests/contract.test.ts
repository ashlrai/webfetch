import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  providerIdSchema as cloudProviderIdSchema,
  searchImagesSchema as cloudSearchImagesSchema,
} from "../cloud/workers/src/schemas.ts";
import { commonSearchOpts as cloudCommonSearchOpts } from "../cloud/workers/src/schemas.ts";
import {
  buildApiUrl as buildChromeApiUrl,
  apiPathForBase as chromeApiPathForBase,
} from "../extension/src/shared/api.ts";
import {
  ALL_PROVIDERS,
  LICENSE_POLICIES,
  LICENSE_RANK,
  PROVIDER_IDS,
} from "../packages/core/src/index.ts";
import {
  providerIdSchema as mcpProviderIdSchema,
  searchImagesSchema as mcpSearchImagesSchema,
} from "../packages/mcp/src/schema.ts";
import { commonSearchOpts as mcpCommonSearchOpts } from "../packages/mcp/src/schema.ts";
import {
  providerIdSchema as serverProviderIdSchema,
  searchImagesSchema as serverSearchImagesSchema,
} from "../packages/server/src/schema.ts";
import { commonSearchOpts as serverCommonSearchOpts } from "../packages/server/src/schema.ts";
import {
  buildApiUrl as buildVscodeApiUrl,
  apiPathForBase as vscodeApiPathForBase,
} from "../vscode-extension/src/lib/client.ts";

describe("provider contract", () => {
  test("schemas accept the canonical provider list", () => {
    const canonical = [...PROVIDER_IDS];
    expect(Object.keys(ALL_PROVIDERS).sort()).toEqual([...canonical].sort());
    expect([...serverProviderIdSchema.options]).toEqual(canonical);
    expect([...mcpProviderIdSchema.options]).toEqual(canonical);
    expect([...cloudProviderIdSchema.options]).toEqual(canonical);

    for (const schema of [serverSearchImagesSchema, mcpSearchImagesSchema, cloudSearchImagesSchema]) {
      expect(schema.safeParse({ query: "apollo", providers: canonical }).success).toBe(true);
    }
  });

  test("schemas accept the canonical license policy list", () => {
    const canonical = [...LICENSE_POLICIES];
    expect([...serverCommonSearchOpts.licensePolicy.unwrap().options]).toEqual(canonical);
    expect([...mcpCommonSearchOpts.licensePolicy.unwrap().options]).toEqual(canonical);
    expect([...cloudCommonSearchOpts.licensePolicy.unwrap().options]).toEqual(canonical);

    for (const policy of canonical) {
      for (const schema of [serverSearchImagesSchema, mcpSearchImagesSchema, cloudSearchImagesSchema]) {
        expect(schema.safeParse({ query: "apollo", licensePolicy: policy }).success).toBe(true);
      }
    }
  });

  test("Python and VS Code literal mirrors stay aligned with core", () => {
    const pythonTypes = readFileSync("packages/sdk-python/webfetch/types.py", "utf8");
    const vscodeTypes = readFileSync("vscode-extension/src/types.ts", "utf8");
    const vscodeManifest = readFileSync("vscode-extension/package.json", "utf8");

    for (const provider of PROVIDER_IDS) {
      expect(pythonTypes).toContain(`"${provider}"`);
      expect(vscodeTypes).toContain(`"${provider}"`);
      expect(vscodeManifest).toContain(`"${provider}"`);
    }

    for (const license of Object.keys(LICENSE_RANK)) {
      expect(pythonTypes).toContain(`${license} = "${license}"`);
      expect(vscodeTypes).toContain(`"${license}"`);
    }

    for (const policy of LICENSE_POLICIES) {
      expect(pythonTypes).toContain(`"${policy}"`);
      expect(vscodeTypes).toContain(`"${policy}"`);
      expect(vscodeManifest).toContain(`"${policy}"`);
    }
  });
});

describe("client API paths", () => {
  test("cloud API requests use /v1 for metered endpoints", () => {
    expect(chromeApiPathForBase("https://api.getwebfetch.com", "/search")).toBe("/v1/search");
    expect(vscodeApiPathForBase("https://api.getwebfetch.com", "/license")).toBe("/v1/license");
    expect(buildChromeApiUrl("https://api.getwebfetch.com", "/probe")).toBe(
      "https://api.getwebfetch.com/v1/probe",
    );
    expect(buildVscodeApiUrl("https://api.getwebfetch.com", "/download")).toBe(
      "https://api.getwebfetch.com/v1/download",
    );
  });

  test("local API requests keep legacy unversioned paths", () => {
    expect(chromeApiPathForBase("http://127.0.0.1:7600", "/search")).toBe("/search");
    expect(vscodeApiPathForBase("http://localhost:7600", "/license")).toBe("/license");
    expect(chromeApiPathForBase("https://api.getwebfetch.com", "/providers")).toBe("/providers");
    expect(vscodeApiPathForBase("https://api.getwebfetch.com/v1", "/search")).toBe("/search");
  });
});

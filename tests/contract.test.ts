import { describe, expect, test } from "bun:test";
import { providerIdSchema as cloudProviderIdSchema } from "../cloud/workers/src/schemas.ts";
import { commonSearchOpts as cloudCommonSearchOpts } from "../cloud/workers/src/schemas.ts";
import {
  buildApiUrl as buildChromeApiUrl,
  apiPathForBase as chromeApiPathForBase,
} from "../extension/src/shared/api.ts";
import { ALL_PROVIDERS, LICENSE_POLICIES, PROVIDER_IDS } from "../packages/core/src/index.ts";
import { providerIdSchema as mcpProviderIdSchema } from "../packages/mcp/src/schema.ts";
import { commonSearchOpts as mcpCommonSearchOpts } from "../packages/mcp/src/schema.ts";
import { providerIdSchema as serverProviderIdSchema } from "../packages/server/src/schema.ts";
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
  });

  test("schemas accept the canonical license policy list", () => {
    const canonical = [...LICENSE_POLICIES];
    expect([...serverCommonSearchOpts.licensePolicy.unwrap().options]).toEqual(canonical);
    expect([...mcpCommonSearchOpts.licensePolicy.unwrap().options]).toEqual(canonical);
    expect([...cloudCommonSearchOpts.licensePolicy.unwrap().options]).toEqual(canonical);
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

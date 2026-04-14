import { afterEach, describe, expect, it } from "bun:test";

import type { ImageCandidate } from "@webfetch/core";
import {
  _setVisionClientFactory,
  buildVisionPrompt,
  parseVisionReply,
  pickHeroImage,
} from "../src/index.ts";

afterEach(() => {
  _setVisionClientFactory(null);
});

const candidates: ImageCandidate[] = [
  { url: "https://x/1.jpg", source: "browser", license: "UNKNOWN" },
  { url: "https://x/2.jpg", source: "browser", license: "UNKNOWN" },
  { url: "https://x/3.jpg", source: "browser", license: "UNKNOWN" },
  { url: "https://x/4.jpg", source: "browser", license: "UNKNOWN" },
];

describe("parseVisionReply", () => {
  it("extracts the first integer in range", () => {
    expect(parseVisionReply("3", 4)).toBe(3);
    expect(parseVisionReply("answer: 2 (it is the hero)", 4)).toBe(2);
    expect(parseVisionReply("0", 4)).toBe(0);
  });

  it("returns null on out-of-range", () => {
    expect(parseVisionReply("9", 4)).toBeNull();
    expect(parseVisionReply("-1", 4)).toBeNull();
    expect(parseVisionReply("no number here", 4)).toBeNull();
  });
});

describe("buildVisionPrompt", () => {
  it("numbers candidates starting at 1", () => {
    const prompt = buildVisionPrompt(candidates);
    expect(prompt).toContain("1. https://x/1.jpg");
    expect(prompt).toContain("4. https://x/4.jpg");
  });
});

describe("pickHeroImage", () => {
  it("returns the candidate at the index the model chose", async () => {
    _setVisionClientFactory(() => ({
      messages: {
        create: async () => ({
          content: [{ type: "text", text: "3" }],
        }),
      },
    }));
    const hero = await pickHeroImage(
      new Uint8Array([1, 2, 3]),
      candidates,
      { anthropicKey: "test" },
    );
    expect(hero?.url).toBe("https://x/3.jpg");
  });

  it("returns null on reply 0", async () => {
    _setVisionClientFactory(() => ({
      messages: {
        create: async () => ({
          content: [{ type: "text", text: "0" }],
        }),
      },
    }));
    const hero = await pickHeroImage(
      new Uint8Array([1, 2, 3]),
      candidates,
      { anthropicKey: "test" },
    );
    expect(hero).toBeNull();
  });

  it("returns null when candidates list is empty", async () => {
    // factory never called — make sure we don't hit the SDK.
    _setVisionClientFactory(() => {
      throw new Error("should not be called");
    });
    const hero = await pickHeroImage(
      new Uint8Array([1]),
      [],
      { anthropicKey: "test" },
    );
    expect(hero).toBeNull();
  });
});

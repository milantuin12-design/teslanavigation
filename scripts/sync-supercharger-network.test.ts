import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("Supercharger network sync safety", () => {
  it("protects legacy and manual rows from scheduled public-data updates", () => {
    const source = fs.readFileSync("scripts/sync-supercharger-network.mjs", "utf8");
    expect(source).toContain('if (match.data_source !== "automatic")');
    expect(source).toContain("protected: true");
    expect(source).toContain('match.source_ref = sourceRef');
    expect(source.indexOf('if (match.data_source !== "automatic")')).toBeLessThan(
      source.indexOf("match.source_ref = sourceRef"),
    );
  });

  it("only creates newly discovered rows as explicitly automatic", () => {
    const source = fs.readFileSync("scripts/sync-supercharger-network.mjs", "utf8");
    expect(source).toContain('data_source: "automatic"');
    expect(source).toContain("dataset.chargers.push(...additions)");
  });
});

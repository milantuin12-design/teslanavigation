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

  it("always caps V2 hardware at 150 kW while preserving V3/V4 reported power", () => {
    const source = fs.readFileSync("scripts/sync-supercharger-network.mjs", "utf8");
    expect(source).toContain('if (version === "V2") return 150');
    expect(source).toContain("const configs = siteConfigs(versions, site.powerKilowatt)");
    expect(source).toContain("max_speed_kw: maxPower");
    expect(source).toContain("charger_configs: configs");
  });

  it("only creates newly discovered rows as explicitly automatic", () => {
    const source = fs.readFileSync("scripts/sync-supercharger-network.mjs", "utf8");
    expect(source).toContain('data_source: "automatic"');
    expect(source).toContain("dataset.chargers.push(...additions)");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Business presentation foundation", () => {
  const css = readFileSync(resolve(process.cwd(), "src/styles/business.css"), "utf8");
  const layout = readFileSync(resolve(process.cwd(), "src/layout/BusinessLayout.tsx"), "utf8");

  it("provides desktop, tablet and narrow responsive layouts without a second design system", () => {
    expect(css).toContain("grid-template-columns: 270px");
    expect(css).toContain("@media (max-width: 1020px)");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain("min-width: 0");
  });

  it("keeps the Ads setup navigation readable at 430px and 390px without page overflow", () => {
    expect(css).toMatch(/\.editor-section-nav a\s*\{[^}]*display:\s*grid;[^}]*min-width:\s*0;/s);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.editor-section-nav\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*overflow:\s*visible;/s);
    expect(css).toMatch(/@media \(max-width:\s*430px\)[\s\S]*?\.editor-section-nav\s*\{[^}]*grid-template-columns:\s*1fr;/s);
    expect(css).toMatch(/\.ads-v2-workspace\s*\{[^}]*max-width:\s*100%;/s);
    expect(css).toMatch(/\.form-field select\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
    expect(css).toMatch(/\.ads-operational-panel \.compact-actions > button\s*\{[^}]*white-space:\s*normal;/s);
  });

  it("uses the Nelyon Business brand palette", () => {
    expect(css.toLowerCase()).toContain("#0c1f4f");
    expect(css.toLowerCase()).toContain("#123b9e");
    expect(css.toLowerCase()).toContain("#1f79ff");
    expect(css.toLowerCase()).toContain("#f5f7fa");
  });

  it("marks every future module as disabled rather than linking to fake data", () => {
    expect(layout).toContain("future-nav");
    expect(layout).toContain("disabled");
    expect(layout).toContain("Próximamente");
  });
});

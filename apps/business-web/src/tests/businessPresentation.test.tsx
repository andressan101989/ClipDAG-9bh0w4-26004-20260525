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

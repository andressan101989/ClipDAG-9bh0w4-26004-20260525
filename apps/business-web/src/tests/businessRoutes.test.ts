import { describe, expect, it } from "vitest";
import { businessPath, validateBusinessReturnTo } from "../lib/businessRoutes";

describe("Business route authority", () => {
  it("prefixes private paths exactly once", () => {
    expect(businessPath("/home")).toBe("/business/home");
    expect(businessPath("/invitations?invitation=abc")).toBe("/business/invitations?invitation=abc");
    expect(businessPath("/business/finance")).toBe("/business/finance");
  });

  it("accepts only safe non-login Business return paths", () => {
    const origin = "https://nelyon.app";
    for (const path of ["/business/home", "/business/orders/abc", "/business/invitations?invitation=123"]) {
      expect(validateBusinessReturnTo(path, origin)).toBe(path);
    }
    for (const path of [
      "https://evil.example/business/home", "//evil.example/business/home", "javascript:alert(1)",
      "data:text/html,evil", "\\\\evil.example", "/business\\evil.example",
      "%2f%2fevil.example", "/%2f%2fevil.example", "/business/%2e%2e/login",
      "/business/login", "/business/login?returnTo=/business/home", "/business", "/ads",
    ]) {
      expect(validateBusinessReturnTo(path, origin)).toBe("/business/home");
    }
  });
});

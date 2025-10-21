// src/__tests__/utils.test.js
import { describe, it, expect } from "vitest";
import { replacePlaceholders } from "../utils/printUtils";

describe("replacePlaceholders", () => {
  it("replaces single placeholder", () => {
    const html = "Hello {{name}}";
    expect(replacePlaceholders(html, { name: "Alice" })).toBe("Hello Alice");
  });

  it("leaves missing token empty", () => {
    const html = "Hello {{missing}}";
    expect(replacePlaceholders(html, {})).toBe("Hello ");
  });

  it("replaces many tokens", () => {
    const html = "{{a}} - {{b}} - {{c}}";
    expect(replacePlaceholders(html, { a: 1, b: 2, c: 3 })).toBe("1 - 2 - 3");
  });
});

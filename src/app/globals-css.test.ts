import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("global accessibility styles", () => {
  it("disables non-essential motion for reduced-motion users", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");

    const reducedMotionRule = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

    expect(reducedMotionRule).toContain("scroll-behavior: auto !important");
    expect(reducedMotionRule).toContain("animation-duration: 0.01ms !important");
    expect(reducedMotionRule).toContain("animation-iteration-count: 1 !important");
    expect(reducedMotionRule).toContain("transition-duration: 0.01ms !important");
  });
});

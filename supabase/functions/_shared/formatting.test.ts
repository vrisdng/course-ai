import { describe, expect, it } from "vitest";

import {
  FORMATTING_CODE_GUIDANCE,
  FORMATTING_FORMATTING_EXTRA,
  FORMATTING_MATH_GUIDANCE,
} from "./formatting.ts";

describe("chat formatting guidance", () => {
  it("instructs LaTeX for block and inline math", () => {
    expect(FORMATTING_MATH_GUIDANCE).toContain("LaTeX");
    expect(FORMATTING_MATH_GUIDANCE).toContain("$$...$$");
    expect(FORMATTING_MATH_GUIDANCE).toContain("$...$");
  });

  it("instructs fenced code blocks with a language label", () => {
    expect(FORMATTING_CODE_GUIDANCE).toContain("fenced code blocks");
    expect(FORMATTING_CODE_GUIDANCE).toContain("backticks");
    expect(FORMATTING_CODE_GUIDANCE).toContain("language label");
  });

  it("joins both pieces for the FORMATTING paragraph", () => {
    expect(FORMATTING_FORMATTING_EXTRA).toBe(
      `${FORMATTING_MATH_GUIDANCE} ${FORMATTING_CODE_GUIDANCE}`,
    );
    expect(FORMATTING_FORMATTING_EXTRA).toContain("LaTeX");
    expect(FORMATTING_FORMATTING_EXTRA).toContain("fenced code blocks");
  });
});

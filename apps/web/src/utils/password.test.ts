import { describe, expect, it } from "vitest";

import {
  getPasswordRequirements,
  isPasswordStrong,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "./password";

describe("password validation", () => {
  it("matches the shared minimum, character and maximum rules", () => {
    expect(isPasswordStrong("Abc12345")).toBe(true);
    expect(isPasswordStrong("abc12345")).toBe(false);
    expect(isPasswordStrong("Abc1234")).toBe(false);
    expect(isPasswordStrong(`A${"a".repeat(PASSWORD_MAX_LENGTH - 1)}1`)).toBe(false);
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  it("counts Unicode code points and accepts Unicode decimal digits like Python \\d", () => {
    expect(isPasswordStrong("A😀bc1234")).toBe(true);
    expect(isPasswordStrong("Abc１２３４５")).toBe(true);
    expect(getPasswordRequirements(`A${"a".repeat(127)}1`)).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "maxLength", ok: false })]),
    );
  });
});

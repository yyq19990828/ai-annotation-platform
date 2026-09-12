import { describe, expect, it } from "vitest";
import {
  issueObjectLabel,
  issuePinAriaLabel,
  issuePinColorVar,
  issuePinSymbol,
  shortIssueObjectId,
} from "./issuePinVisuals";

describe("issue pin visuals", () => {
  it.each([
    ["open", "info", "--sc-status-info-alt", "i"],
    ["open", "warn", "--sc-status-caution", "!"],
    ["open", "blocker", "--sc-status-danger", "×"],
    ["open", null, "--sc-status-caution", "!"],
    ["resolved", "blocker", "--sc-status-positive", "✓"],
    ["wont_fix", "info", "--sc-muted-foreground", "–"],
  ] as const)("maps %s/%s to shared token and symbol", (status, severity, token, symbol) => {
    expect(issuePinColorVar(status, severity)).toBe(token);
    expect(issuePinSymbol(status, severity)).toBe(symbol);
  });

  it("keeps state and severity readable to assistive labels", () => {
    expect(issuePinAriaLabel({ status: "resolved", severity: "blocker" })).toBe(
      "Issue：已解决 · 阻断",
    );
    expect(issuePinAriaLabel({ status: "open", severity: null })).toBe("Issue：未解决 · 警告");
  });

  it("formats object identity consistently", () => {
    expect(shortIssueObjectId("annotation-123456")).toBe("anno…3456");
    expect(issueObjectLabel("annotation-123456", "车辆")).toBe("车辆 · anno…3456");
  });
});

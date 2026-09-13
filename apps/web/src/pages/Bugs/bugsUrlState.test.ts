import { describe, expect, it } from "vitest";
import { BUGS_URL_DEFAULTS, bugsUrlCodec, parseBugsUrl } from "./bugsUrlState";

describe("Bugs URL state", () => {
  it("round-trips supported status/severity values and preserves unrelated keys", () => {
    const encoded = bugsUrlCodec.encode(new URLSearchParams("returnTo=%2Faudit"), {
      status: "in_progress",
      severity: "critical",
    });
    expect(encoded.get("returnTo")).toBe("/audit");
    expect(parseBugsUrl(encoded).state).toEqual({ status: "in_progress", severity: "critical" });
  });

  it("falls back to empty filters for invalid values", () => {
    const parsed = parseBugsUrl("?status=unknown&severity=urgent");
    expect(parsed.state).toEqual(BUGS_URL_DEFAULTS);
    expect(parsed.issues.map((item) => item.key)).toEqual(["status", "severity"]);
  });
});

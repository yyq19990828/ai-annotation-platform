import { describe, expect, it } from "vitest";
import { AUDIT_URL_DEFAULTS, auditUrlCodec, parseAuditUrl } from "./auditUrlState";

describe("Audit URL state", () => {
  it("accepts an explicit business scope default", () => {
    expect(parseAuditUrl("?scope=business").issues).toEqual([]);
  });

  it("round-trips deep-link filters and retains an explicitly empty detail value", () => {
    const encoded = auditUrlCodec.encode(new URLSearchParams("from=kept&business_only=false"), {
      ...AUDIT_URL_DEFAULTS,
      actorId: "u1",
      targetType: "task",
      targetId: "t1",
      detailKey: "role",
      detailValue: "",
      scope: "all",
      page: 3,
    });
    expect(encoded.get("from")).toBe("kept");
    expect(encoded.get("business_only")).toBe("false");
    expect(encoded.get("scope")).toBe("all");
    expect(encoded.get("detail_value")).toBe("");
    expect(parseAuditUrl(encoded).state).toMatchObject({
      actorId: "u1",
      targetType: "task",
      targetId: "t1",
      detailKey: "role",
      detailValue: "",
      scope: "all",
      page: 3,
    });
  });

  it("clears only owned keys when returning to defaults", () => {
    const encoded = auditUrlCodec.encode(
      new URLSearchParams("focus=u1&action=task.approve&scope=all&page=4"),
      AUDIT_URL_DEFAULTS,
    );
    expect(encoded.toString()).toBe("focus=u1");
  });
});

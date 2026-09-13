import { describe, expect, it } from "vitest";

import {
  projectTemplatesUrlCodec,
  parseProjectTemplatesUrlWithIssues,
  templateScopeForApi,
} from "./projectTemplatesUrlState";

describe("Project templates URL filter state", () => {
  it("defaults to private and preserves explicit all scope", () => {
    expect(parseProjectTemplatesUrlWithIssues("q=car").state).toEqual({
      query: "car",
      scope: "private",
    });
    expect(parseProjectTemplatesUrlWithIssues("q=car&scope=all").state).toEqual({
      query: "car",
      scope: "all",
    });
    expect(templateScopeForApi("all")).toBeUndefined();
    expect(templateScopeForApi("organization")).toBe("organization");
  });

  it("omits the private default but keeps unrelated parameters", () => {
    const encoded = projectTemplatesUrlCodec.encode(new URLSearchParams("keep=1&scope=public"), {
      query: "",
      scope: "private",
    });
    expect(encoded.toString()).toBe("keep=1");
    const all = projectTemplatesUrlCodec.encode(new URLSearchParams("keep=1"), {
      query: "q",
      scope: "all",
    });
    expect(all.get("scope")).toBe("all");
    expect(all.get("q")).toBe("q");
  });
});

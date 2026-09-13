import { describe, expect, it } from "vitest";

import { datasetsUrlCodec, parseDatasetsUrlWithIssues } from "./datasetsUrlState";

describe("Datasets URL filter state", () => {
  it("restores q/type while preserving the dataset deep link", () => {
    const parsed = parseDatasetsUrlWithIssues("dataset=ds1&q=  lidar  &data_type=point_cloud");
    expect(parsed).toEqual({
      state: { query: "lidar", data_type: "point_cloud" },
      issues: [],
    });

    const encoded = datasetsUrlCodec.encode(
      new URLSearchParams("dataset=ds1&keep=1"),
      parsed.state,
    );
    expect(encoded.get("dataset")).toBe("ds1");
    expect(encoded.get("keep")).toBe("1");
    expect(encoded.get("q")).toBe("lidar");
    expect(encoded.get("data_type")).toBe("point_cloud");
  });

  it("treats omitted and all type values as the default and reports unknown values", () => {
    expect(parseDatasetsUrlWithIssues("data_type=all").state).toEqual({ query: "" });
    expect(parseDatasetsUrlWithIssues("data_type=unknown").issues).toHaveLength(1);
  });
});

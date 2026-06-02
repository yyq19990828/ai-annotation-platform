import { describe, expect, it } from "vitest";
import { statSeriesHint, statSparkValues, statTrendFromSeries } from "./projectStatsSeries";

describe("projectStatsSeries", () => {
  it("uses a backend series as sparkline input", () => {
    const values = [10, 12, 15];
    expect(statSparkValues(values)).toBe(values);
    expect(statSeriesHint(values)).toBe("近 12 周");
  });

  it("computes trend from first and last points", () => {
    expect(statTrendFromSeries([50, 60, 75])).toBe(50);
    expect(statTrendFromSeries([100, 80, 75])).toBe(-25);
  });

  it("does not show a percent trend from a zero baseline", () => {
    expect(statTrendFromSeries([0, 10, 20])).toBeUndefined();
  });
});

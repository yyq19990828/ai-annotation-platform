import { describe, expect, it } from "vitest";
import { getWsHost } from "./wsHost";

describe("getWsHost", () => {
  it("keeps the direct API connection for local DEV", () => {
    expect(getWsHost({ hostname: "localhost", host: "localhost:3000" }, undefined)).toBe(
      "localhost:8000",
    );
  });

  it("uses the page origin for remote DEV access", () => {
    expect(getWsHost({ hostname: "172.26.1.23", host: "172.26.1.23:3000" }, undefined)).toBe(
      "172.26.1.23:3000",
    );
  });

  it("honors an explicit worktree override", () => {
    expect(getWsHost({ hostname: "dev.example", host: "dev.example:3000" }, "dev.example:8010")).toBe(
      "dev.example:8010",
    );
  });
});

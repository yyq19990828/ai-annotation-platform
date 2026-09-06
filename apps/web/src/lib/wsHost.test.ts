import { describe, expect, it } from "vitest";
import { getWsHost } from "./wsHost";

describe("getWsHost", () => {
  it("uses the page origin for local DEV", () => {
    expect(getWsHost({ host: "localhost:3000" }, undefined)).toBe("localhost:3000");
  });

  it("keeps an SSH LocalForward origin instead of connecting to the visitor's API port", () => {
    expect(getWsHost({ host: "localhost:13000" }, undefined)).toBe("localhost:13000");
  });

  it("uses the page origin for remote DEV access", () => {
    expect(getWsHost({ host: "172.26.1.23:3000" }, undefined)).toBe("172.26.1.23:3000");
  });

  it("honors an explicit worktree override", () => {
    expect(getWsHost({ host: "dev.example:3000" }, "dev.example:8010")).toBe("dev.example:8010");
  });
});

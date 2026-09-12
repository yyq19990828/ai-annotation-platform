import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn((..._args: unknown[]) => Promise.resolve({}));

vi.mock("./client", () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import { projectTemplatesApi } from "./projectTemplates";

beforeEach(() => get.mockClear());

describe("projectTemplatesApi.list", () => {
  it("serializes scope/search and forwards AbortSignal", () => {
    const signal = new AbortController().signal;
    projectTemplatesApi.list({ scope: "organization", search: "car" }, { signal });
    expect(get).toHaveBeenCalledWith("/project-templates?scope=organization&search=car", {
      signal,
    });
  });
});

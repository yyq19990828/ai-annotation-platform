import { describe, expect, it } from "vitest";

import { apiErrorDetailMessage } from "./client";

describe("apiErrorDetailMessage", () => {
  it("提取 FastAPI 请求体校验错误的字段路径", () => {
    expect(
      apiErrorDetailMessage([
        {
          type: "string_type",
          loc: ["body", "candidate", "candidate", "value", "masklabels", 0],
          msg: "Input should be a valid string",
        },
      ]),
    ).toBe("candidate.candidate.value.masklabels.0：Input should be a valid string");
  });

  it("保持字符串和结构化 message 错误兼容", () => {
    expect(apiErrorDetailMessage("plain error")).toBe("plain error");
    expect(apiErrorDetailMessage({ message: "structured error" })).toBe("structured error");
  });
});

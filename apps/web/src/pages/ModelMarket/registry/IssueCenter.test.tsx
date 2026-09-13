import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IssueCenter } from "./IssueCenter";
import type { RegistryScope } from "./registryTypes";

describe("IssueCenter filter summaries", () => {
  it("does not reserve a summary row when no conditions are applied", () => {
    // The empty branch reads only diagnostics; no topology rows are rendered.
    const scope = { diagnostics: [] } as unknown as RegistryScope;
    render(<IssueCenter scope={scope} />);
    expect(screen.getByText("当前没有诊断告警")).toBeInTheDocument();
    expect(screen.queryByLabelText("已应用的诊断筛选")).not.toBeInTheDocument();
  });
});

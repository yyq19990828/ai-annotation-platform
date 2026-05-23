import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VariantSelector } from "./VariantSelector";

describe("VariantSelector", () => {
  it("renders rich supported_variants metadata when available", () => {
    const onChange = vi.fn();
    render(
      <VariantSelector
        schema={{
          type: "object",
          properties: {
            sam_variant: {
              type: "string",
              enum: ["tiny", "small"],
              default: "tiny",
              title: "SAM 2 变体",
            },
          },
        }}
        supportedVariants={[
          {
            key: "sam_variant",
            title: "SAM 2",
            variants: [
              { value: "tiny", label: "SAM Tiny", vram_gb: 1.5, tier: "fast" },
              {
                value: "small",
                label: "SAM Small",
                vram_gb: 2.5,
                tier: "balanced",
                recommended: true,
                note: "推荐默认档",
              },
            ],
          },
        ]}
        value={{ sam_variant: "small" }}
        onChange={onChange}
      />,
    );

    expect(screen.getByTestId("ai-variant-selector")).toBeInTheDocument();
    expect(screen.getByText("显存约 2.5GB")).toBeInTheDocument();
    expect(screen.getByText("均衡")).toBeInTheDocument();
    expect(screen.getByText("推荐")).toBeInTheDocument();
    expect(screen.getByText("推荐默认档")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("ai-variant-sam_variant"), {
      target: { value: "tiny" },
    });
    expect(onChange).toHaveBeenCalledWith({ sam_variant: "tiny" });
  });

  it("falls back to params enum when rich metadata is absent", () => {
    render(
      <VariantSelector
        schema={{
          type: "object",
          properties: {
            dino_variant: {
              type: "string",
              enum: ["T", "B"],
              default: "T",
              title: "DINO 变体",
            },
          },
        }}
        value={{}}
        onChange={() => {}}
      />,
    );

    const select = screen.getByTestId("ai-variant-dino_variant") as HTMLSelectElement;
    expect(select.value).toBe("T");
    expect(screen.getByRole("option", { name: "B" })).toBeInTheDocument();
  });

  it("renders nothing when no variant axis is declared", () => {
    const { container } = render(
      <VariantSelector
        schema={{
          type: "object",
          properties: {
            score_threshold: { type: "number", default: 0.5 },
          },
        }}
        supportedVariants={[]}
        value={{}}
        onChange={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

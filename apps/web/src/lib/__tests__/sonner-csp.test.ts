import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  document.querySelector('meta[name="csp-nonce"]')?.remove();
  for (const style of document.querySelectorAll("style")) {
    if (style.textContent?.includes("data-sonner-toaster")) style.remove();
  }
  vi.restoreAllMocks();
});

it("authorizes Sonner's stylesheet before inserting it into the CSP-protected page", async () => {
  const meta = document.createElement("meta");
  meta.name = "csp-nonce";
  meta.content = "production-request-nonce";
  document.head.appendChild(meta);

  const insertedNonces: string[] = [];
  const appendChild = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, "appendChild").mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLStyleElement) insertedNonces.push(node.nonce ?? "");
    return appendChild(node);
  });

  await import("sonner");

  const stylesheet = [...document.querySelectorAll("style")].find((style) =>
    style.textContent?.includes("data-sonner-toaster"),
  );
  expect(stylesheet).toBeDefined();
  expect(stylesheet?.nonce).toBe(meta.content);
  expect(insertedNonces).toContain(meta.content);
  expect(insertedNonces).not.toContain("");
});

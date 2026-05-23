import { describe, it, expect } from "vitest";
import { parseSize, fmt, globMatch } from "./check-bundle-size.mjs";

describe("parseSize", () => {
  it("解析裸数字为字节（默认单位 B）", () => {
    expect(parseSize("512")).toBe(512);
    expect(parseSize("0")).toBe(0);
  });

  it("解析 B / KB / MB（1024 进制）", () => {
    expect(parseSize("100 B")).toBe(100);
    expect(parseSize("1 KB")).toBe(1024);
    expect(parseSize("1 MB")).toBe(1024 * 1024);
    expect(parseSize("500 KB")).toBe(500 * 1024);
  });

  it("单位大小写不敏感、允许无空格与小数", () => {
    expect(parseSize("1kb")).toBe(1024);
    expect(parseSize("2Mb")).toBe(2 * 1024 * 1024);
    expect(parseSize("1.5 KB")).toBe(1.5 * 1024);
  });

  it("非法输入抛错", () => {
    expect(() => parseSize("abc")).toThrow(/invalid size/);
    expect(() => parseSize("10 GB")).toThrow(/invalid size/);
    expect(() => parseSize("")).toThrow(/invalid size/);
  });
});

describe("fmt", () => {
  it("< 1 MB 用 KB 一位小数", () => {
    expect(fmt(1024)).toBe("1.0 KB");
    expect(fmt(1536)).toBe("1.5 KB");
  });

  it(">= 1 MB 用 MB 两位小数", () => {
    expect(fmt(1024 * 1024)).toBe("1.00 MB");
    expect(fmt(1.5 * 1024 * 1024)).toBe("1.50 MB");
  });
});

describe("globMatch", () => {
  it("`*` 匹配任意字符（含 hash 后缀）", () => {
    expect(globMatch("index-*.js", "index-a1b2c3.js")).toBe(true);
    expect(globMatch("vendor-konva-*.js", "vendor-konva-deadbeef.js")).toBe(true);
  });

  it("非匹配返回 false", () => {
    expect(globMatch("index-*.js", "vendor-konva-x.js")).toBe(false);
    expect(globMatch("index-*.js", "index-a1b2c3.css")).toBe(false);
  });

  it("正则元字符（`.`）按字面匹配，不当通配", () => {
    expect(globMatch("a.b.js", "axbxjs")).toBe(false);
    expect(globMatch("a.b.js", "a.b.js")).toBe(true);
  });
});

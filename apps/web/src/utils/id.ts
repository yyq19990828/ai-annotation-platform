/**
 * 生成随机 UUID v4。
 *
 * `crypto.randomUUID()` 仅在安全上下文（HTTPS / localhost）+ 较新浏览器可用；
 * 通过 LAN IP 走 http 访问时它是 undefined，裸调用会抛 TypeError。
 * 这里优先用它，否则回退到 `crypto.getRandomValues`（非安全上下文也可用），
 * 最后再退到 Math.random，保证任何环境下都能拿到一个唯一 id。
 */
export function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

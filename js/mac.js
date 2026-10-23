// Brücke zur Mac-App „SQUIZZZzZ Pult“ (mac/Sources/main.swift).
// Im normalen Browser gibt es sie nicht – dann liefern alle Aufrufe einen verständlichen Fehler.

const handler = () => globalThis.webkit?.messageHandlers?.sqz;

export const isMac = () => !!handler();

export function mac(cmd, args = {}) {
  const h = handler();
  if (!h) return Promise.reject(new Error("Das geht nur in der Mac-App „SQUIZZZzZ Pult“."));
  return h.postMessage({ cmd, args });
}

/** Textdatei (z. B. .sqq) relativ zum Ordner SQUIZZZzZ lesen. */
export const readText = (path) => mac("read", { path });

const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic" };

/** Binärdatei (z. B. Titelbild) als Blob lesen. */
export async function readBlob(path) {
  const b64 = await mac("read", { path, base64: true });
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = (path.split(".").pop() || "").toLowerCase();
  return new Blob([bytes], { type: MIME[ext] || "application/octet-stream" });
}

/** Ordnerinhalt: [{ name, dir, size }] */
export const listDir = (path) => mac("list", { path });

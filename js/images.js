// Bilder im Browser verkleinern, bevor sie in die Datenbank gehen (Logos, Titelbilder, Warteseite).
export function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Bild konnte nicht gelesen werden.")); };
    img.src = url;
  });
}
/** Verkleinert auf max. Breite/Höhe; type "image/png" (Transparenz) oder "image/jpeg". */
export async function shrink(file, max = 1280, type = "image/jpeg", quality = 0.85) {
  const img = await loadImage(file);
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(type, quality);
}

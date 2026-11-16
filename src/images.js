// Preparar fotos antes de subirlas (sobre todo desde Mac, iPhone e iPad):
// - HEIC/HEIF (formato de Apple) → JPG, si el navegador sabe abrirlo (Safari sí).
// - Fotos muy grandes → se reducen (lado mayor 2560 px) y se comprimen a JPG.
// - Se respeta la orientación de la cámara (no salen giradas).

import { IMAGE_TYPES, extOf } from './utils.js';

// Para el selector: "image/*" hace que el iPad ofrezca Fototeca, Cámara y Archivos
export const IMAGE_ACCEPT = 'image/*,.heic,.heif,.jpg,.jpeg,.png,.gif,.webp';

const MAX_SIDE = 2560;
const MAX_KEEP_BYTES = 2.5 * 1024 * 1024; // por debajo de esto (y de MAX_SIDE) se sube tal cual
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

export const isHeic = (f) => /hei[cf]/i.test(f.type || '') || /\.(heic|heif)$/i.test(f.name || '');
const baseName = (name) => (name || 'foto').replace(/\.[^.]+$/, '') || 'foto';

/** Devuelve un File listo para subir (jpg/png/gif/webp) o lanza un error con un mensaje claro. */
export async function prepareImage(file) {
  const heic = isHeic(file);
  const ext = extOf(file.name) || MIME_EXT[file.type];
  if (!heic && !IMAGE_TYPES[ext]) throw new Error(`"${file.name}": formato no válido (usa JPG, PNG, GIF, WEBP o HEIC).`);

  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(heic
      ? `"${file.name}" es una foto HEIC y este navegador no la puede abrir. Súbela desde Safari (Mac/iPad) o expórtala como JPG.`
      : `"${file.name}" no es una imagen válida.`);
  }
  const { width, height } = bmp;
  const tooBig = Math.max(width, height) > MAX_SIDE || file.size > MAX_KEEP_BYTES;

  // Se queda como está: ya es un formato normal y no es enorme (o es un GIF, para no perder la animación)
  if (!heic && (!tooBig || ext === 'gif')) {
    bmp.close?.();
    return extOf(file.name) ? file : new File([file], `${baseName(file.name)}.${ext}`, { type: IMAGE_TYPES[ext] });
  }

  // Convertir/reducir a JPG
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx2d = canvas.getContext('2d');
  ctx2d.fillStyle = '#ffffff'; // las zonas transparentes quedan en blanco
  ctx2d.fillRect(0, 0, w, h);
  ctx2d.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.86));
  if (!blob) throw new Error(`No se pudo preparar "${file.name}".`);
  return new File([blob], `${baseName(file.name)}.jpg`, { type: 'image/jpeg' });
}

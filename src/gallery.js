// Varias fotos juntas: collage tipo WhatsApp (2, 3, 4 o "+N") y visor a pantalla completa.

import { el } from './ui.js';

/**
 * images: [{ src, alt }]. onOpen(i): al tocar una foto (si no se pasa, el collage es solo para ver).
 * Muestra como mucho 4; en la última pone "+N" si hay más.
 */
export function collage(images, { onOpen = null, className = '' } = {}) {
  const n = images.length;
  const shown = images.slice(0, 4);
  const box = el('div', { class: `collage n${Math.min(n, 4)} ${className}`.trim() });
  shown.forEach((img, i) => {
    const more = i === 3 && n > 4 ? n - 4 : 0;
    const cell = el(onOpen ? 'button' : 'div', {
      class: 'collage-cell', ...(onOpen ? { type: 'button', 'aria-label': more ? `Ver las ${n} fotos` : `Ver foto ${i + 1} de ${n}` } : {}),
    }, el('img', { src: img.src, alt: img.alt || '', loading: 'lazy', draggable: 'false' }),
    more ? el('span', { class: 'collage-more', text: `+${more}` }) : null);
    if (onOpen) cell.addEventListener('click', (e) => { e.stopPropagation(); onOpen(i); });
    box.append(cell);
  });
  return box;
}

// ---------------------------------------------------------------------
// Visor: una foto en grande, con flechas, deslizar el dedo y Esc
// ---------------------------------------------------------------------

export function openLightbox(images, start = 0) {
  if (!images.length) return;
  let i = Math.max(0, Math.min(start, images.length - 1));
  let dlg = document.getElementById('lightbox');
  if (!dlg) { dlg = el('dialog', { id: 'lightbox', 'aria-label': 'Fotos' }); document.body.append(dlg); }

  const img = el('img', { class: 'lb-img', alt: '', draggable: 'false' });
  const counter = el('span', { class: 'lb-count' });
  const open = el('a', { class: 'lb-btn lb-open', target: '_blank', rel: 'noopener', title: 'Abrir el original en otra pestaña', text: 'Original' });
  const prev = el('button', { class: 'lb-btn lb-nav lb-prev', type: 'button', 'aria-label': 'Foto anterior', text: '‹', onclick: () => go(-1) });
  const next = el('button', { class: 'lb-btn lb-nav lb-next', type: 'button', 'aria-label': 'Foto siguiente', text: '›', onclick: () => go(1) });
  const close = () => { dlg.close(); };
  const thumbs = images.length > 1 ? el('div', { class: 'lb-thumbs' }, ...images.map((im, k) =>
    el('button', { class: 'lb-thumb', type: 'button', 'aria-label': `Foto ${k + 1}`, onclick: () => show(k) }, el('img', { src: im.src, alt: '', loading: 'lazy', draggable: 'false' })))) : null;

  function show(k, dir = 0) {
    i = (k + images.length) % images.length;
    img.src = images[i].src;
    img.alt = images[i].alt || '';
    open.href = images[i].src;
    counter.textContent = images.length > 1 ? `${i + 1} / ${images.length}` : '';
    prev.hidden = next.hidden = images.length < 2;
    thumbs?.querySelectorAll('.lb-thumb').forEach((t, n) => t.classList.toggle('on', n === i));
    thumbs?.children[i]?.scrollIntoView({ block: 'nearest', inline: 'center' });
    if (dir && img.animate) img.animate([{ opacity: 0.3, transform: `translateX(${dir * 30}px)` }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
  }
  const go = (d) => show(i + d, d);

  const stage = el('div', { class: 'lb-stage' }, img, prev, next);
  // Tocar el fondo (no la foto) cierra
  stage.addEventListener('click', (e) => { if (e.target === stage) close(); });
  // Deslizar con el dedo
  let x0 = null;
  stage.addEventListener('touchstart', (e) => { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50 && images.length > 1) go(dx < 0 ? 1 : -1);
  });

  dlg.replaceChildren(el('div', { class: 'lb' },
    el('header', { class: 'lb-head' }, counter, el('span', { class: 'tp-spacer' }), open,
      el('button', { class: 'lb-btn', type: 'button', 'aria-label': 'Cerrar', title: 'Cerrar (Esc)', text: '✕', onclick: close })),
    stage, thumbs));
  dlg.onkeydown = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  };
  dlg.onclose = () => dlg.replaceChildren();
  show(i);
  dlg.showModal();
  next.hidden || next.focus({ preventScroll: true });
}

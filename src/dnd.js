// Drag & drop con Pointer Events: funciona con ratón y con el dedo.
// En táctil hay que mantener pulsado un momento (así el scroll sigue funcionando).
// Animaciones: la tarjeta se "levanta" y se inclina según la velocidad, las demás
// se apartan con suavidad y al soltar la tarjeta vuela a su sitio.

const HOLD_MS = 260;
const EDGE = 70; // zona junto al borde que activa el desplazamiento automático
const MAX_SPEED = 18; // px por fotograma
const TAB_DWELL_MS = 350;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(.2, .8, .2, 1)';

export function initDnd(root, { onStart, onEnd, onDrop, onTab }) {
  let s = null;
  let landing = false; // animación de soltar en curso

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || s || landing) return;
    const card = e.target.closest('.card');
    if (!card || e.target.closest('button, a, input, select, textarea, iframe')) return;
    s = { card, id: card.dataset.id, x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, pid: e.pointerId, touch: e.pointerType !== 'mouse', active: false };
    if (s.touch) {
      card.classList.add('pressing');
      s.timer = setTimeout(start, HOLD_MS);
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!s || e.pointerId !== s.pid) return;
    s.px = e.clientX;
    s.py = e.clientY;
    if (!s.active) {
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) {
        if (s.touch) reset(); // el usuario está haciendo scroll
        else start();
      }
      return;
    }
    e.preventDefault();
    place();
  }, { passive: false });

  window.addEventListener('pointerup', (e) => { if (s && e.pointerId === s.pid && !(s.touch && s.active)) finish(true); });
  window.addEventListener('pointercancel', (e) => {
    // Con el dedo, el navegador cancela los eventos de puntero al intentar hacer scroll:
    // si ya estamos arrastrando, seguimos con los eventos táctiles de abajo.
    if (s && e.pointerId === s.pid && !(s.touch && s.active)) finish(false);
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && s?.active) finish(false); });

  // Arrastre táctil: touchmove bloquea el scroll y mueve la tarjeta
  document.addEventListener('touchmove', (e) => {
    if (!s?.active || !s.touch) return;
    e.preventDefault();
    const t = e.touches[0];
    s.px = t.clientX;
    s.py = t.clientY;
    place();
  }, { passive: false });
  document.addEventListener('touchend', () => { if (s?.active && s.touch) finish(true); });
  document.addEventListener('touchcancel', () => { if (s?.active && s.touch) finish(false); });
  root.addEventListener('contextmenu', (e) => { if (s) e.preventDefault(); });

  function start() {
    if (!s) return;
    const { card } = s;
    const r = card.getBoundingClientRect();
    Object.assign(s, {
      active: true, offX: s.x - r.left, offY: s.y - r.top,
      tilt: 0, scale: 1, lastX: s.px, moved: false,
    });
    s.ghost = card.cloneNode(true);
    s.ghost.classList.add('ghost');
    s.ghost.classList.remove('pressing', 'enter');
    s.ghost.style.width = `${r.width}px`;
    document.body.append(s.ghost);
    s.placeholder = document.createElement('div');
    s.placeholder.className = 'placeholder';
    s.placeholder.style.height = `${r.height}px`;
    card.before(s.placeholder);
    card.classList.add('dragging');
    card.classList.remove('pressing');
    document.body.classList.add('is-dragging');
    navigator.vibrate?.(15);
    onStart();
    highlight();
    s.raf = requestAnimationFrame(frame);
  }

  // Bucle de animación: posición e inclinación de la tarjeta + desplazamiento automático
  function frame() {
    if (!s?.active) return;
    const { px, py } = s;
    const vx = px - s.lastX;
    s.lastX = px;
    const still = reduced();
    s.tilt += ((still ? 0 : Math.max(-8, Math.min(8, vx * 0.9))) - s.tilt) * 0.2;
    s.scale += ((still ? 1 : 1.04) - s.scale) * 0.25;
    s.ghost.style.transform = `translate(${px - s.offX}px, ${py - s.offY}px) rotate(${s.tilt.toFixed(2)}deg) scale(${s.scale.toFixed(3)})`;

    // No desplazar hasta que la tarjeta se haya movido un poco
    if (!s.moved) s.moved = Math.hypot(px - s.x, py - s.y) > 40;
    if (s.moved) {
      const speed = (d) => Math.round(MAX_SPEED * Math.min(1, (EDGE - d) / EDGE) ** 2);
      let scrolled = false;
      if (py < EDGE) { window.scrollBy(0, -speed(py)); scrolled = true; }
      else if (py > innerHeight - EDGE) { window.scrollBy(0, speed(innerHeight - py)); scrolled = true; }
      // Móvil (columnas en fila): con el dedo en el borde se pasa a la columna de al lado,
      // de una en una y con una pausa, para poder soltar donde se quiera
      if (root.scrollWidth > root.clientWidth && (px < EDGE / 2 + 10 || px > innerWidth - EDGE / 2 - 10)) {
        const now = performance.now();
        if (!s.colAt) s.colAt = now + 250; // pequeña espera antes del primer salto
        if (now >= s.colAt) {
          const cols = [...root.querySelectorAll('.column')];
          const cur = Math.round(root.scrollLeft / (cols[1].offsetLeft - cols[0].offsetLeft));
          const next = Math.max(0, Math.min(cols.length - 1, cur + (px < innerWidth / 2 ? -1 : 1)));
          if (next !== cur) {
            root.scrollTo({ left: cols[next].offsetLeft - cols[0].offsetLeft, behavior: reduced() ? 'auto' : 'smooth' });
            onTab(cols[next].dataset.status, true);
          }
          s.colAt = now + 750;
        }
        scrolled = true;
      } else {
        s.colAt = 0;
      }
      if (scrolled) place();
    }
    s.raf = requestAnimationFrame(frame);
  }

  // Decide dónde va el hueco según la posición del puntero
  function place() {
    const { px, py } = s;
    const under = document.elementFromPoint(px, py);

    // Sobre una pestaña (móvil): si el dedo se queda un momento, se cambia a esa columna
    const tab = under?.closest('.tab[data-status]');
    const hover = tab?.dataset.status || null;
    if (hover !== s.tabHover) {
      s.tabHover = hover;
      clearTimeout(s.tabTimer);
      if (hover) {
        s.tabTimer = setTimeout(() => {
          if (!s?.active || s.tabHover !== hover) return;
          onTab(hover);
          movePlaceholder(root.querySelector(`.cards[data-status="${hover}"]`), null, true);
        }, TAB_DWELL_MS);
      }
    }
    if (tab) return;

    const list = under?.closest('.column')?.querySelector('.cards');
    if (!list) return;
    const siblings = [...list.querySelectorAll('.card:not(.dragging)')];
    const before = siblings.find((c) => {
      const r = c.getBoundingClientRect();
      return py < r.top + r.height / 2;
    }) || null;
    const already = before ? before.previousElementSibling === s.placeholder : list.lastElementChild === s.placeholder && s.placeholder.parentElement === list;
    if (!already) movePlaceholder(list, before);
  }

  function movePlaceholder(list, before, atStart = false) {
    flip(() => {
      if (atStart) list.prepend(s.placeholder);
      else list.insertBefore(s.placeholder, before);
    });
    highlight();
  }

  function highlight() {
    const col = s.placeholder.closest('.column');
    for (const c of root.querySelectorAll('.column')) c.classList.toggle('drop-target', c === col);
  }

  // FLIP: anima las tarjetas que cambian de sitio al moverse el hueco
  function flip(mutate) {
    if (reduced()) return mutate();
    const items = [...root.querySelectorAll('.card:not(.dragging)')];
    const before = new Map(items.map((n) => [n, n.getBoundingClientRect()]));
    mutate();
    for (const n of items) {
      const a = before.get(n);
      const b = n.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      if (Math.abs(dx) > 4) continue; // cambió de columna (no debería): sin animación
      n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 180, easing: EASE });
    }
  }

  function finish(drop) {
    if (!s.active) return reset();
    const st = s;
    s = null;
    cancelAnimationFrame(st.raf);
    clearTimeout(st.tabTimer);
    const { card, placeholder, ghost, id } = st;
    if (!drop) card.before(placeholder); // vuelve a su sitio
    const list = placeholder.parentElement;
    const neighbour = (node, dir) => {
      let n = node[dir];
      while (n && (!n.classList.contains('card') || n === card)) n = n[dir];
      return n?.dataset.id || null;
    };
    const target = drop && list
      ? { status: list.dataset.status, prev: neighbour(placeholder, 'previousElementSibling'), next: neighbour(placeholder, 'nextElementSibling') }
      : null;

    const done = () => {
      placeholder.remove();
      ghost.remove();
      for (const c of root.querySelectorAll('.column.drop-target')) c.classList.remove('drop-target');
      document.body.classList.remove('is-dragging');
      onEnd();
      if (target) onDrop(id, target.status, target.prev, target.next);
      card.classList.remove('dragging');
      landing = false;
    };

    // Aterrizaje: la tarjeta vuela hasta el hueco
    const r = placeholder.getBoundingClientRect();
    if (reduced() || !r.width) return done();
    landing = true;
    const anim = ghost.animate([
      { transform: ghost.style.transform },
      { transform: `translate(${r.left}px, ${r.top}px) rotate(0deg) scale(1)` },
    ], { duration: 200, easing: EASE, fill: 'forwards' });
    anim.onfinish = done;
    anim.oncancel = done;
  }

  function reset() {
    if (!s) return;
    clearTimeout(s.timer);
    s.card.classList.remove('pressing');
    s = null;
  }
}

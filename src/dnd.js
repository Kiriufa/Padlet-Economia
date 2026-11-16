// Drag & drop con Pointer Events: funciona con ratón y con el dedo.
// En táctil hay que mantener pulsado un momento (así el scroll sigue funcionando).

const HOLD_MS = 280;
const EDGE = 60;
const TAB_DWELL_MS = 350;

export function initDnd(root, { onStart, onEnd, onDrop, onTab }) {
  let s = null;

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || s) return;
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
    move();
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
    move();
  }, { passive: false });
  document.addEventListener('touchend', () => { if (s?.active && s.touch) finish(true); });
  document.addEventListener('touchcancel', () => { if (s?.active && s.touch) finish(false); });
  root.addEventListener('contextmenu', (e) => { if (s) e.preventDefault(); });

  function start() {
    if (!s) return;
    const { card } = s;
    const r = card.getBoundingClientRect();
    s.active = true;
    s.offX = s.x - r.left;
    s.offY = s.y - r.top;
    s.ghost = card.cloneNode(true);
    s.ghost.classList.add('ghost');
    s.ghost.classList.remove('pressing');
    s.ghost.style.width = `${r.width}px`;
    document.body.append(s.ghost);
    s.placeholder = document.createElement('div');
    s.placeholder.className = 'placeholder';
    s.placeholder.style.height = `${r.height}px`;
    card.before(s.placeholder);
    card.classList.add('dragging');
    card.classList.remove('pressing');
    document.body.classList.add('is-dragging');
    navigator.vibrate?.(20);
    onStart();
    move();
    s.raf = requestAnimationFrame(autoScroll);
  }

  function move() {
    const { ghost, px, py } = s;
    ghost.style.transform = `translate(${px - s.offX}px, ${py - s.offY}px) rotate(2deg)`;

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
          root.querySelector(`.cards[data-status="${hover}"]`).prepend(s.placeholder);
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
    });
    if (before) { if (before.previousElementSibling !== s.placeholder) list.insertBefore(s.placeholder, before); }
    else if (list.lastElementChild !== s.placeholder) list.append(s.placeholder);
  }

  function autoScroll() {
    if (!s?.active) return;
    const { px, py } = s;
    // No desplazar hasta que la tarjeta se haya movido un poco (si no, al cogerla cerca del borde la página se mueve sola)
    if (!s.moved) s.moved = Math.hypot(px - s.x, py - s.y) > 40;
    if (!s.moved) { s.raf = requestAnimationFrame(autoScroll); return; }
    let dy = 0;
    if (py < EDGE) dy = -12;
    else if (py > innerHeight - EDGE) dy = 12;
    if (dy) window.scrollBy(0, dy);
    if (root.scrollWidth > root.clientWidth) {
      if (px < 24) root.scrollLeft -= 12;
      else if (px > innerWidth - 24) root.scrollLeft += 12;
    }
    if (dy) move();
    s.raf = requestAnimationFrame(autoScroll);
  }

  function finish(drop) {
    if (!s.active) return reset();
    const { card, placeholder, ghost, id } = s;
    cancelAnimationFrame(s.raf);
    clearTimeout(s.tabTimer);
    const list = placeholder.parentElement;
    const neighbour = (node, dir) => {
      let n = node[dir];
      while (n && (!n.classList.contains('card') || n === card)) n = n[dir];
      return n?.dataset.id || null;
    };
    const target = drop && list ? { status: list.dataset.status, prev: neighbour(placeholder, 'previousElementSibling'), next: neighbour(placeholder, 'nextElementSibling') } : null;
    placeholder.remove();
    ghost.remove();
    card.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    s = null;
    onEnd();
    if (target) onDrop(id, target.status, target.prev, target.next);
  }

  function reset() {
    if (!s) return;
    clearTimeout(s.timer);
    s.card.classList.remove('pressing');
    s = null;
  }
}

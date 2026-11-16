// Drag & drop con Pointer Events: funciona con ratón y con el dedo.
// En táctil hay que mantener pulsado un momento (así el scroll sigue funcionando).
// Físicas: la tarjeta gira alrededor del punto por donde la coges, como una hoja de
// papel sobre la mesa. Si tiras desde una esquina, el resto se queda atrás por el
// rozamiento; si la coges por el centro, apenas gira. Al parar, se endereza poco a poco.
// Las demás tarjetas se apartan con suavidad y al soltar la tarjeta vuela a su sitio.

const HOLD_MS = 260;
const EDGE = 70; // zona junto al borde que activa el desplazamiento automático
const MAX_SPEED = 18; // px por fotograma
const TAB_DWELL_MS = 350;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(.2, .8, .2, 1)';

// Constantes de la simulación (por fotograma, ángulos en radianes)
const FRICTION_TORQUE = 0.000003; // cuánto hace girar el rozamiento
const SPRING = 0.006; // tendencia a enderezarse
const DAMPING = 0.16; // amortiguación del giro
const MAX_ANGLE = 0.3; // ~17°
const GAP = 10; // separación entre tarjetas (la de .cards en styles.css)

export function initDnd(root, { onStart, onEnd, onDrop, onTab }) {
  let s = null;
  let landing = false; // animación de soltar en curso

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || s || landing) return;
    const card = e.target.closest('.card');
    if (!card || e.target.closest('button, a, input, select, textarea, iframe')) return;
    s = { card, id: card.dataset.id, x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, pid: e.pointerId, touch: e.pointerType !== 'mouse', active: false };
    // Desde el asa se arrastra al momento, también con el dedo
    if (e.target.closest('.drag-handle')) {
      e.preventDefault();
      if (s.touch) start();
      return;
    }
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
      active: true, offX: s.x - r.left, offY: s.y - r.top, w: r.width, h: r.height,
      angle: 0, spin: 0, scale: 1, lastX: s.px, lastY: s.py, moved: false, gx: s.px, gy: s.py,
    });
    s.ghost = card.cloneNode(true);
    s.ghost.classList.add('ghost');
    s.ghost.classList.remove('pressing', 'enter');
    s.ghost.style.width = `${r.width}px`;
    // Gira alrededor del punto por donde se ha cogido
    s.ghost.style.transformOrigin = `${s.offX}px ${s.offY}px`;
    document.body.append(s.ghost);
    s.placeholder = document.createElement('div');
    s.placeholder.className = 'placeholder';
    s.placeholder.style.height = `${r.height}px`;
    card.before(s.placeholder);
    card.classList.add('dragging');
    card.classList.remove('pressing');
    document.body.classList.add('is-dragging');
    // Las columnas llegan hasta abajo de la pantalla: se puede soltar en cualquier parte de ellas
    root.style.minHeight = `${Math.max(root.offsetHeight, Math.round(innerHeight - root.getBoundingClientRect().top))}px`;
    navigator.vibrate?.(15);
    onStart();
    highlight();
    s.raf = requestAnimationFrame(frame);
  }

  // Bucle de animación: posición e inclinación de la tarjeta + desplazamiento automático
  function frame() {
    if (!s?.active) return;
    const { px, py } = s;
    // La tarjeta va pegada al punto por donde se cogió
    s.gx = px; s.gy = py;
    const vx = s.gx - s.lastX, vy = s.gy - s.lastY;
    s.lastX = s.gx; s.lastY = s.gy;
    if (reduced()) {
      s.angle = 0; s.scale = 1;
    } else {
      // Vector desde el punto de agarre hasta el centro de la tarjeta, girado con ella
      const cx = s.w / 2 - s.offX, cy = s.h / 2 - s.offY;
      const cos = Math.cos(s.angle), sin = Math.sin(s.angle);
      const rx = cx * cos - cy * sin, ry = cx * sin + cy * cos;
      // El rozamiento actúa en el centro, en contra del movimiento: par = r × F
      const torque = (rx * -vy - ry * -vx) * FRICTION_TORQUE;
      s.spin += torque - s.angle * SPRING - s.spin * DAMPING;
      s.angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, s.angle + s.spin));
      s.scale += (1.04 - s.scale) * 0.25;
    }
    s.ghost.style.transform = `translate(${(s.gx - s.offX).toFixed(1)}px, ${(s.gy - s.offY).toFixed(1)}px) rotate(${s.angle.toFixed(4)}rad) scale(${s.scale.toFixed(3)})`;

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

    // La columna se elige por la posición horizontal: vale toda la columna, de arriba abajo,
    // y también el hueco entre columnas o la parte de debajo (se coge la más cercana)
    const list = columnAt(px, under)?.querySelector('.cards');
    if (!list) return;
    const siblings = [...list.querySelectorAll('.card:not(.dragging)')];
    const before = siblings.find((c) => {
      const r = c.getBoundingClientRect();
      return py < r.top + r.height / 2;
    }) || null;
    const already = before ? before.previousElementSibling === s.placeholder : list.lastElementChild === s.placeholder && s.placeholder.parentElement === list;
    if (!already) movePlaceholder(list, before);
  }

  function columnAt(px, under) {
    const direct = under?.closest('.column');
    if (direct && root.contains(direct)) return direct;
    let best = null, dist = Infinity;
    for (const c of root.querySelectorAll('.column')) {
      const r = c.getBoundingClientRect();
      if (r.right < 0 || r.left > innerWidth) continue; // fuera de la pantalla (móvil)
      const d = px < r.left ? r.left - px : px > r.right ? px - r.right : 0;
      if (d < dist) { dist = d; best = c; }
    }
    return best;
  }

  function movePlaceholder(list, before, atStart = false) {
    const ph = s.placeholder;
    const from = ph.parentElement;
    const put = () => { if (atStart) list.prepend(ph); else list.insertBefore(ph, before); };
    if (from && from !== list && !reduced()) {
      // Cambio de columna: el hueco se cierra suavemente en la columna de origen
      // y se abre en la nueva, empujando a las tarjetas poco a poco
      const h = ph.offsetHeight;
      const gap = document.createElement('div');
      gap.className = 'placeholder-gap';
      gap.style.height = `${h}px`;
      from.insertBefore(gap, ph);
      put();
      const close = gap.animate([{ height: `${h}px`, marginBottom: '0px', opacity: 1 }, { height: '0px', marginBottom: `${-GAP}px`, opacity: 0 }],
        { duration: 240, easing: EASE, fill: 'forwards' });
      close.onfinish = close.oncancel = () => gap.remove();
      ph.animate([{ height: '0px', marginBottom: `${-GAP}px`, opacity: 0 }, { height: `${h}px`, marginBottom: '0px', opacity: 1 }],
        { duration: 240, easing: EASE });
    } else {
      flip(put);
    }
    highlight();
  }

  function highlight() {
    const col = s.placeholder.closest('.column');
    for (const c of root.querySelectorAll('.column')) {
      const on = c === col;
      if (on && !c.classList.contains('drop-target') && !reduced()) {
        // Pequeño "latido" al entrar en una columna nueva
        c.animate([{ boxShadow: '0 0 0 0 rgb(45 91 215 / 35%)' }, { boxShadow: '0 0 0 10px rgb(45 91 215 / 0%)' }], { duration: 450, easing: 'ease-out' });
      }
      c.classList.toggle('drop-target', on);
    }
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

    // Aterrizaje: la tarjeta vuela hasta el hueco (más tiempo cuanto más lejos) y se asienta
    placeholder.getAnimations().forEach((a) => a.finish());
    root.querySelectorAll('.placeholder-gap').forEach((g) => g.remove());
    const r = placeholder.getBoundingClientRect();
    const finishAll = () => {
      root.style.minHeight = '';
      done();
      if (target && !reduced()) {
        requestAnimationFrame(() => {
          const n = root.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
          n?.animate([{ transform: 'scale(1.03)' }, { transform: 'scale(.99)' }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
        });
      }
    };
    if (reduced() || !r.width) return finishAll();
    landing = true;
    const dist = Math.hypot(r.left - (st.gx - st.offX), r.top - (st.gy - st.offY));
    const anim = ghost.animate([
      { transform: ghost.style.transform },
      { transform: `translate(${r.left}px, ${r.top}px) rotate(0rad) scale(1)` },
    ], { duration: Math.round(Math.min(380, 180 + dist * 0.35)), easing: 'cubic-bezier(.25, 1.15, .4, 1)', fill: 'forwards' });
    anim.onfinish = finishAll;
    anim.oncancel = finishAll;
  }

  function reset() {
    if (!s) return;
    clearTimeout(s.timer);
    s.card.classList.remove('pressing');
    s = null;
  }
}

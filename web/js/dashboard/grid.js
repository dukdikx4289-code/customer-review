/*
 * กริดการ์ดที่ลากจัดวางใหม่ได้ (vanilla JS ไม่พึ่งไลบรารี)
 *
 *  - เมาส์/ปากกา: ลากได้ทันที (ขยับเกิน 5px ถึงนับว่าลาก เพื่อให้คลิกปกติยังใช้ได้)
 *  - จอสัมผัส: กดค้าง ~0.35 วินาทีก่อน จึงยังเลื่อนหน้าได้ตามปกติ
 *  - คีย์บอร์ด: โฟกัสการ์ด แล้วกด Alt + ลูกศร
 *  - ลำดับที่จัดไว้ถูกจำใน localStorage ของเบราว์เซอร์ (แต่ละคนจัดของตัวเอง)
 *  - การจัดวางจริงใช้ CSS grid (grid-auto-flow: dense) เราแค่สลับลำดับ DOM และทำแอนิเมชันแบบ FLIP
 *
 * ใช้งาน:  const board = createBoard({ tiles: [{ id, el }], storageKey: 'rv.layout.x' });
 *          container.append(board.el);   board.reset();  // กลับลำดับเริ่มต้น
 */
import { h } from '../util.js';

const LONG_PRESS_MS = 350; // จอสัมผัส: เวลากดค้างก่อนยกการ์ด
const PRESS_SLOP = 8; // จอสัมผัส: ขยับได้เท่านี้ระหว่างกดค้าง (เกินถือว่าเลื่อนหน้า)
const MOUSE_SLOP = 5; // เมาส์: ขยับเกินเท่านี้ถึงเริ่มลาก
const SETTLE_MS = 70; // เว้นระยะระหว่างการสลับตำแหน่งสองครั้ง
const ENTER = 0.18; // ต้องลากเข้าไปในการ์ดเป้าหมายลึกประมาณนี้ (สัดส่วนของขนาด) ถึงสลับ
const EDGE = 70; // ระยะจากขอบจอที่เริ่มเลื่อนหน้าอัตโนมัติ

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function readOrder(key, defaults) {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(key) ?? '[]');
  } catch {
    /* localStorage ใช้ไม่ได้ (โหมดส่วนตัว ฯลฯ) — ใช้ลำดับเริ่มต้น */
  }
  const valid = Array.isArray(saved) ? saved.filter((id) => defaults.includes(id)) : [];
  return [...valid, ...defaults.filter((id) => !valid.includes(id))]; // การ์ดใหม่ต่อท้าย
}

export function createBoard({ tiles, storageKey, onChange, animate = true }) {
  const defaults = tiles.map((t) => t.id);
  const byId = new Map(tiles.map((t) => [t.id, t.el]));
  const board = h('div', { class: `board editable${animate ? '' : ' no-anim'}`, role: 'list' });
  readOrder(storageKey, defaults).forEach((id) => board.append(byId.get(id)));
  for (const el of byId.values()) el.setAttribute('role', 'listitem');

  const all = () => [...board.children];
  const ids = () => all().map((el) => el.dataset.widgetId);

  function refreshAria() {
    all().forEach((el, i, list) => {
      el.setAttribute('aria-posinset', i + 1);
      el.setAttribute('aria-setsize', list.length);
    });
  }
  refreshAria();

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(ids()));
    } catch {
      /* ไม่เป็นไร: แค่ไม่จำลำดับ */
    }
    onChange?.(ids());
  }

  /**
   * ตำแหน่งจริงของการ์ดตามกริด (ไม่รวม transform/แอนิเมชันที่กำลังเล่นอยู่)
   * ใช้ offsetLeft/Top ซึ่งไม่ถูกกระทบ transform — ไม่งั้นการ์ดที่กำลังเลื่อนผ่านใต้ตัวชี้จะถูกสลับกลับไปมา
   */
  function layoutRect(el) {
    const b = board.getBoundingClientRect();
    const left = b.left + el.offsetLeft;
    const top = b.top + el.offsetTop;
    return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight, width: el.offsetWidth, height: el.offsetHeight };
  }

  /** FLIP: จดตำแหน่งเดิม → เปลี่ยน DOM → เล่นแอนิเมชันจากตำแหน่งเดิมไปตำแหน่งใหม่ */
  function flip(mutate, skip) {
    const first = new Map(all().map((el) => [el, el.getBoundingClientRect()]));
    mutate();
    refreshAria();
    if (reduceMotion()) return;
    for (const el of all()) {
      if (el === skip) continue;
      const a = first.get(el);
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    }
  }

  /* ---------------- ลาก (เมาส์ / สัมผัส) ---------------- */
  let drag = null;
  let swallowUntil = 0;

  const swallowClick = () => {
    swallowUntil = performance.now() + 300;
  };
  board.addEventListener('click', (e) => {
    if (performance.now() < swallowUntil) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  board.addEventListener('contextmenu', (e) => {
    if (drag) e.preventDefault(); // กดค้างบน Android จะเด้งเมนู — กันไว้
  });
  // ขณะยกการ์ดด้วยนิ้ว ห้ามหน้าเลื่อนตาม
  board.addEventListener('touchmove', (e) => {
    if (drag?.active && e.cancelable) e.preventDefault();
  }, { passive: false });

  board.addEventListener('pointerdown', (e) => {
    if (drag || e.button !== 0 || !e.isPrimary) return;
    const el = e.target.closest('.w');
    if (!el || e.target.closest('a, button, input, select, textarea, summary, [data-nodrag]')) return;
    drag = { el, id: e.pointerId, type: e.pointerType, sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY, tx: 0, ty: 0, active: false, last: 0, lastSwap: null, raf: 0, timer: 0 };
    if (drag.type === 'touch') {
      el.classList.add('is-holding');
      drag.timer = window.setTimeout(lift, LONG_PRESS_MS);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  });

  function lift() {
    if (!drag || drag.active) return;
    const r = drag.el.getBoundingClientRect();
    drag.grabX = drag.sx - r.left;
    drag.grabY = drag.sy - r.top;
    drag.active = true;
    drag.before = ids().join();
    drag.el.classList.remove('is-holding', 'is-landed');
    drag.el.classList.add('is-lifted');
    document.body.classList.add('dragging');
    getSelection()?.removeAllRanges();
    if (drag.type === 'touch') navigator.vibrate?.(10);
    const loop = () => {
      if (!drag?.active) return;
      const speed = drag.py < EDGE ? -(EDGE - drag.py) / 4 : drag.py > innerHeight - EDGE ? (drag.py - (innerHeight - EDGE)) / 4 : 0;
      if (speed) {
        window.scrollBy(0, speed);
        follow();
      }
      drag.raf = requestAnimationFrame(loop);
    };
    drag.raf = requestAnimationFrame(loop);
  }

  /** ให้การ์ดที่ลากอยู่ตามนิ้ว/เมาส์ (ชดเชยเมื่อตำแหน่งจริงของมันเปลี่ยนจากการสลับ/การเลื่อนหน้า) */
  function follow() {
    const base = layoutRect(drag.el);
    drag.tx = drag.px - drag.grabX - base.left;
    drag.ty = drag.py - drag.grabY - base.top;
    drag.el.style.transform = `translate(${drag.tx}px, ${drag.ty}px)`;
    reorder();
  }

  function reorder() {
    const now = performance.now();
    if (now - drag.last < SETTLE_MS) return;
    const target = all().find((el) => {
      if (el === drag.el) return false;
      const r = layoutRect(el);
      const mx = r.width * ENTER;
      const my = r.height * ENTER;
      return drag.px > r.left + mx && drag.px < r.right - mx && drag.py > r.top + my && drag.py < r.bottom - my;
    });
    if (!target) return;
    // กันสลับไปมากับการ์ดเดิมซ้ำๆ จนกว่าตัวชี้จะขยับออกไปพอสมควร
    const s = drag.lastSwap;
    if (s && s.id === target.dataset.widgetId && Math.hypot(drag.px - s.x, drag.py - s.y) < 24) return;
    drag.last = now;
    drag.lastSwap = { id: target.dataset.widgetId, x: drag.px, y: drag.py };
    const after = all().indexOf(target) > all().indexOf(drag.el);
    flip(() => (after ? target.after(drag.el) : target.before(drag.el)), drag.el);
    follow();
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.px = e.clientX;
    drag.py = e.clientY;
    const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
    if (!drag.active) {
      if (drag.type === 'touch') {
        if (moved > PRESS_SLOP) cancel(); // ผู้ใช้กำลังเลื่อนหน้า ไม่ใช่ลาก
      } else if (moved > MOUSE_SLOP) {
        lift();
        follow();
      }
      return;
    }
    follow();
  }

  function cleanup() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    window.clearTimeout(drag.timer);
    cancelAnimationFrame(drag.raf);
    drag.el.classList.remove('is-holding');
  }

  function cancel() {
    cleanup();
    drag = null;
  }

  function onEnd(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { el, active, tx, ty, before } = drag;
    cleanup();
    drag = null;
    if (!active) return;
    document.body.classList.remove('dragging');
    swallowClick();
    el.classList.remove('is-lifted');
    el.style.transform = '';
    if (!reduceMotion()) el.animate([{ transform: `translate(${tx}px, ${ty}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    el.classList.add('is-landed');
    setTimeout(() => el.classList.remove('is-landed'), 620);
    if (ids().join() !== before) save();
  }

  /* ---------------- คีย์บอร์ด: Alt + ลูกศร ---------------- */
  board.addEventListener('keydown', (e) => {
    if (!e.altKey || !e.target.classList?.contains('w')) return;
    const el = e.target;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const sibling = step > 0 ? el.nextElementSibling : el.previousElementSibling;
    if (!sibling) return;
    flip(() => (step > 0 ? sibling.after(el) : sibling.before(el)));
    el.focus();
    save();
  });

  return {
    el: board,
    /** กลับลำดับเริ่มต้นและลบค่าที่จำไว้ */
    reset() {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* ไม่เป็นไร */
      }
      flip(() => defaults.forEach((id) => board.append(byId.get(id))));
    },
  };
}

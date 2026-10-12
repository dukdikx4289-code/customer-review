// ลูกเล่น: เปิด/ปิดตามการตั้งค่า "ลดการเคลื่อนไหว", reveal ตอนเลื่อน, ตัวเลขนับขึ้น, พื้นหลัง orb
// สไตล์ของทุกอย่างอยู่ที่ css/effects.css — ปิดทั้งหมดได้ด้วย <html class="no-fx">
import { h } from '../util.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;

export const motionOK = () => !root.classList.contains('no-fx') && !reduce.matches;

/** เรียกครั้งเดียวต่อหน้า: เติม class "fx" (ถ้าอนุญาต) และสร้างชั้น orb */
export function initEffects({ orbs = true } = {}) {
  const apply = () => root.classList.toggle('fx', motionOK());
  apply();
  reduce.addEventListener('change', apply);
  if (orbs && !document.querySelector('.orbs')) {
    document.body.prepend(h('div', { class: 'orbs', 'aria-hidden': 'true' }, h('i', { class: 'orb o1' }), h('i', { class: 'orb o2' }), h('i', { class: 'orb o3' })));
  }
}

/**
 * ทำให้ element ที่มี class "reveal" ค่อยๆ เลื่อนขึ้น/จางเข้าเมื่อเลื่อนมาถึง (หน่วงตามลำดับ)
 * เมื่อเล่นจบจะถอด class ออกทั้งหมด เพื่อไม่ให้ transition ของ reveal ไปรบกวน hover/ลากภายหลัง
 */
export function reveal(scope = document) {
  const items = [...scope.querySelectorAll('.reveal:not(.active)')];
  if (!items.length) return;
  if (!motionOK() || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.remove('reveal'));
    return;
  }
  const finish = (el) => {
    const clean = () => {
      el.classList.remove('reveal', 'active');
      el.style.removeProperty('--delay');
    };
    el.addEventListener('transitionend', (e) => e.target === el && e.propertyName === 'transform' && clean(), { once: true });
    setTimeout(clean, 2200); // เผื่อ transitionend ไม่ยิง
  };
  items.forEach((el, i) => el.style.setProperty('--delay', Math.min(i, 8)));
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        e.target.classList.add('active');
        finish(e.target);
      }
    },
    { threshold: 0.08, rootMargin: '0px 0px -6% 0px' },
  );
  items.forEach((el) => io.observe(el));
}

const easeOutExpo = (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t));

/** นับตัวเลขจาก 0 ขึ้นไปค่าจริง (ค่าจริงอยู่ใน DOM ตั้งแต่แรก — ผู้อ่านหน้าจอเห็นค่าจริงเสมอ) */
export function countUp(el, { duration = 900 } = {}) {
  const to = Number(el.dataset.countTo);
  const finalText = el.textContent;
  if (!motionOK() || !Number.isFinite(to) || el.dataset.counted) return;
  el.dataset.counted = '1';
  const decimals = (finalText.split('.')[1] ?? '').replace(/\D.*$/, '').length;
  const suffix = el.dataset.countSuffix ?? '';
  const start = performance.now();
  const frame = (now) => {
    const t = Math.min(1, (now - start) / duration);
    el.textContent = `${(to * easeOutExpo(t)).toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = finalText;
  };
  requestAnimationFrame(frame);
}

export function countAll(scope = document) {
  scope.querySelectorAll('[data-count-to]').forEach((el) => countUp(el));
}

// หน้าต่างรายละเอียด ใช้ <dialog> เนทีฟ: Esc ปิดได้, โฟกัสถูกกักในกล่อง, พื้นหลังคลิกไม่ได้, คืนโฟกัสให้ปุ่มเดิมตอนปิด
import { h } from '../util.js';

let counter = 0;

/** openModal({ title, eyebrow?, body, opener? }) → คืน <dialog> (เรียก .close() เพื่อปิดเองได้) */
export function openModal({ title, eyebrow, body, opener = document.activeElement }) {
  const titleId = `modal-title-${++counter}`;
  let cleaned = false;

  // ทำซ้ำได้ปลอดภัย: เรียกจากปุ่มปิด/คลิกพื้นหลัง/Esc (event "close") ได้หลายทางโดยไม่ซ้ำซ้อน
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    dialog.remove();
    opener?.focus?.();
  };
  const dismiss = () => {
    if (dialog.open) dialog.close();
    cleanup();
  };

  const close = h('button', { class: 'modal-close', type: 'button', 'aria-label': 'ปิด', onclick: dismiss }, '×');
  const dialog = h(
    'dialog',
    { class: 'modal', 'aria-labelledby': titleId },
    h('div', { class: 'modal-head' }, h('div', {}, eyebrow ? h('p', { class: 'eyebrow' }, eyebrow) : null, h('h2', { id: titleId }, title)), close),
    h('div', { class: 'modal-body' }, body),
  );
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dismiss(); // คลิกพื้นหลังมืด
  });
  dialog.addEventListener('close', cleanup); // Esc
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

import { api, ApiError } from '../api.js';
import { h, toast } from '../util.js';

export async function accountView() {
  const me = await api('/admin/me');
  const current = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const next = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
  const error = h('p', { class: 'alert error hidden', role: 'alert' });

  const form = h('form', { class: 'card stack', novalidate: true }, h('h2', {}, 'เปลี่ยนรหัสผ่าน'), h('label', { class: 'field' }, h('span', {}, 'รหัสผ่านปัจจุบัน'), current), h('label', { class: 'field' }, h('span', {}, 'รหัสผ่านใหม่ (อย่างน้อย 10 ตัวอักษร)'), next), error, h('button', { class: 'btn primary', type: 'submit' }, 'บันทึก'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.classList.add('hidden');
    try {
      await api('/admin/change-password', { method: 'POST', body: { current: current.value, next: next.value } });
      current.value = next.value = '';
      toast('เปลี่ยนรหัสผ่านแล้ว');
    } catch (err) {
      error.textContent = err instanceof ApiError && err.status === 401 ? 'รหัสผ่านปัจจุบันไม่ถูกต้อง' : 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 10 ตัวอักษร';
      error.classList.remove('hidden');
    }
  });

  const logout = h('button', { class: 'btn', type: 'button', onclick: async () => { await api('/admin/logout', { method: 'POST' }); location.replace('/admin/login.html'); } }, 'ออกจากระบบ');

  return h('div', { class: 'stack' }, h('div', { class: 'page-head' }, h('h1', {}, 'บัญชี')), h('p', {}, 'เข้าสู่ระบบในชื่อ ', h('strong', {}, me.username)), form, logout);
}

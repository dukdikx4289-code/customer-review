import { api, ApiError } from '../api.js';
import { initEffects, reveal } from '../ui/motion.js';

initEffects();
reveal();

const form = document.getElementById('form');
const error = document.getElementById('error');

// ถ้าล็อกอินอยู่แล้วไปหน้าหลักเลย
api('/admin/me').then(() => location.replace('/admin/')).catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.classList.add('hidden');
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const data = new FormData(form);
    await api('/admin/login', { method: 'POST', body: { username: data.get('username'), password: data.get('password') } });
    location.replace('/admin/');
  } catch (err) {
    error.textContent =
      err instanceof ApiError && err.status === 401
        ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
        : err instanceof ApiError && err.status === 429
          ? 'ลองผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่'
          : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง';
    error.classList.remove('hidden');
    button.disabled = false;
  }
});

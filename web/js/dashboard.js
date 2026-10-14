import { api, ApiError } from './api.js';
import { h, clear, tokenFromPath } from './util.js';
import { renderDashboard } from './dashboard-view.js';
import { initEffects } from './ui/motion.js';

initEffects();

const app = document.getElementById('app');
const token = tokenFromPath();
const view = { range: '30d', branchId: null, channel: '' };
let lastData = null;

function message(title, text) {
  clear(app).append(h('div', { class: 'card empty' }, h('h1', {}, title), h('p', {}, text)));
}

async function load() {
  try {
    const q = new URLSearchParams({ range: view.range });
    if (view.branchId) q.set('branch_id', view.branchId);
    if (view.channel) q.set('channel', view.channel);
    lastData = await api(`/d/${encodeURIComponent(token)}/stats?${q}`);
    draw();
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) message('ลิงก์นี้ใช้งานไม่ได้', 'ลิงก์อาจถูกยกเลิกหรือหมดอายุ กรุณาติดต่อผู้ดูแลระบบเพื่อขอลิงก์ใหม่');
    else if (err instanceof ApiError && err.status === 429) message('เปิดบ่อยเกินไป', 'กรุณารอสักครู่แล้วลองใหม่');
    else message('โหลดข้อมูลไม่สำเร็จ', 'กรุณาลองรีเฟรชหน้านี้อีกครั้ง');
  }
}

function draw() {
  document.title = lastData.title ? `${lastData.title} — Dashboard` : document.title;
  renderDashboard(app, lastData, {
    ...view,
    showBranchFilter: true,
    layoutKey: 'exec',
    onChange: (next) => {
      Object.assign(view, next);
      load();
    },
  });
}

load();

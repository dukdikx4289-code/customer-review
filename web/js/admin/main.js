import { api, ApiError } from '../api.js';
import { h, clear } from '../util.js';
import { overviewView } from './overview.js';
import { branchesView, branchDetailView } from './branches.js';
import { linksView } from './links.js';
import { surveyView } from './survey.js';
import { responsesView } from './responses.js';
import { accountView } from './account.js';
import { notifyView } from './notify.js';
import { initEffects, reveal } from '../ui/motion.js';

initEffects();

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const menuBtn = document.getElementById('menu-btn');

const routes = {
  overview: overviewView,
  branches: branchesView,
  branch: branchDetailView,
  links: linksView,
  survey: surveyView,
  responses: responsesView,
  notify: notifyView,
  account: accountView,
};

// เติมลูกเล่นให้ทุกหน้าโดยไม่ต้องแก้ view ทีละไฟล์: การ์ดเลื่อนขึ้นตอนเลื่อนมาถึง, การ์ดรายการยกขึ้นตอน hover
function decorate(scope) {
  scope.querySelectorAll('.page-head, .card, .table-wrap').forEach((el) => el.classList.add('reveal'));
  scope.querySelectorAll('.link-card, .list > article.card').forEach((el) => el.classList.add('lift'));
  reveal(scope);
}

menuBtn.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menuBtn.setAttribute('aria-expanded', String(open));
});

let renderId = 0;

async function route() {
  const [name = 'overview', param] = location.hash.replace(/^#\/?/, '').split('/');
  const view = routes[name] ?? overviewView;
  const current = ++renderId;
  nav.classList.remove('open');
  menuBtn.setAttribute('aria-expanded', 'false');
  for (const a of nav.querySelectorAll('a')) {
    const active = a.dataset.route === (name === 'branch' ? 'branches' : name);
    active ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  }
  clear(app).append(h('p', { class: 'muted' }, 'กำลังโหลด…'));
  try {
    const node = await view({ param, app, isStale: () => current !== renderId });
    if (current === renderId && node) {
      clear(app).append(node);
      decorate(app);
    }
  } catch (err) {
    if (current !== renderId) return;
    if (err instanceof ApiError && err.status === 401) return location.replace('/admin/login.html');
    clear(app).append(h('div', { class: 'alert error' }, 'เกิดข้อผิดพลาด กรุณารีเฟรชหน้าแล้วลองใหม่ ', h('code', {}, err.message)));
  }
}

// ตรวจว่าล็อกอินอยู่ก่อนวาดหน้า
api('/admin/me')
  .then(() => {
    window.addEventListener('hashchange', route);
    route();
  })
  .catch(() => location.replace('/admin/login.html'));

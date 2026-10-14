import { api } from '../api.js';
import { h } from '../util.js';
import { renderDashboard } from '../dashboard-view.js';

/** ใช้ซ้ำทั้งหน้าภาพรวม (ทุกสาขา) และหน้ารายสาขา */
export async function statsPanel({ branchId = null, showBranchFilter = false }) {
  const holder = h('div', {});
  const view = { range: '30d', branchId, channel: '' };
  let last = null;

  const draw = () =>
    renderDashboard(holder, last, {
      ...view,
      showBranchFilter,
      layoutKey: branchId ? 'admin-branch' : 'admin',
      onChange: (next) => {
        Object.assign(view, next);
        load();
      },
    });

  async function load() {
    const q = new URLSearchParams({ range: view.range });
    if (view.branchId) q.set('branch_id', view.branchId);
    if (view.channel) q.set('channel', view.channel);
    last = await api(`/admin/stats?${q}`);
    // ในหน้ารายสาขา branchOptions มีครบ แต่ไม่ต้องแสดงตัวกรอง
    draw();
  }

  await load();
  return holder;
}

export async function overviewView() {
  return h('div', {}, await statsPanel({ showBranchFilter: true }));
}

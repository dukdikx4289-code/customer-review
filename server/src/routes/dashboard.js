import { Router } from 'express';
import { db } from '../db/knex.js';
import { resolveLink } from '../services/links.js';
import { getStats } from '../services/aggregate.js';
import { normalizeChannel } from '../services/questions.js';
import { badTokenLimiter } from '../middleware/rateLimit.js';

export const dashboardRouter = Router();

// ลิงก์ผู้บริหารเป็น read-only เท่านั้น: มีแค่ GET
dashboardRouter.get('/d/:token/stats', badTokenLimiter, async (req, res) => {
  const link = await resolveLink(req.params.token, 'dashboard');
  if (!link) return res.status(404).json({ error: 'not_found' });

  // บันทึกการใช้งานลิงก์ เพื่อให้แอดมินสังเกตความผิดปกติได้ (ไม่บันทึก token)
  await db('share_links').where({ id: link.id }).update({ last_used_at: db.fn.now(3), hit_count: db.raw('hit_count + 1') });

  const survey = await db('surveys').where({ id: link.survey_id }).first();
  const stats = await getStats({
    surveyId: link.survey_id,
    branchId: link.branch_id ?? (Number(req.query.branch_id) || null),
    channel: normalizeChannel(req.query.channel),
    range: req.query.range,
  });
  // ลิงก์ที่ผูกกับสาขาเดียวไม่ควรเห็นรายชื่อสาขาอื่น
  const branchOptions = link.branch_id ? [] : stats.branchOptions;
  res.json({ title: survey?.title ?? '', scope: link.label, ...stats, branchOptions });
});

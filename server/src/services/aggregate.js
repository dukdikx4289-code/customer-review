import { db } from '../db/knex.js';
import { config } from '../config.js';
import { getLatestVersion } from './links.js';
import { CHANNELS, CHANNEL_LABELS, inChannel } from './questions.js';

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;
const RANGES = { '7d': 7, '30d': 30, '90d': 90, all: null };
const ATTENTION_THRESHOLD = 3.5; // ค่าเฉลี่ยต่ำกว่านี้ถือว่าควรแก้ไข
const ATTENTION_MIN_RESPONSES = 3; // ต้องมีตัวอย่างอย่างน้อยเท่านี้จึงจะเตือน

export function normalizeRange(range) {
  return Object.hasOwn(RANGES, range) ? range : '30d';
}

/** เริ่มต้นของ "วันนี้" ตามเวลาไทย (ในรูป UTC Date) ลบย้อนหลัง days-1 วัน */
export function rangeStart(range, now = new Date()) {
  const days = RANGES[normalizeRange(range)];
  if (days == null) return null;
  const bkkNow = now.getTime() + BKK_OFFSET_MS;
  const bkkMidnight = bkkNow - (bkkNow % 86_400_000);
  return new Date(bkkMidnight - BKK_OFFSET_MS - (days - 1) * 86_400_000);
}

const num = (v) => (v == null ? null : Number(v));
const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

function applyFilters(query, { surveyId, branchId, channel, from, to }) {
  query.where('r.survey_id', surveyId);
  if (branchId) query.where('r.branch_id', branchId);
  if (channel) query.where('r.channel', channel);
  if (from) query.where('r.submitted_at', '>=', from);
  if (to) query.where('r.submitted_at', '<', to);
  return query;
}

/** สรุปสั้นๆ ของช่วงเวลาหนึ่ง ใช้เทียบ "ช่วงก่อนหน้า" (ลูกศรขึ้น/ลงบน Dashboard) */
async function periodTotals(filters, primary) {
  const [{ n }] = await applyFilters(db('responses as r').count({ n: '*' }), filters);
  const result = { responses: Number(n), satisfactionRate: null, primaryAvg: null };
  if (!primary) return result;
  const max = primary.config?.max ?? 5;
  const [row] = await applyFilters(db('answers as a').join('responses as r', 'r.id', 'a.response_id'), filters)
    .where('a.question_key', primary.key)
    .whereNotNull('a.value_number')
    .select(db.raw('AVG(a.value_number) as avg'), db.raw('COUNT(*) as rated'), db.raw('SUM(a.value_number >= ?) as satisfied', [max - 1]));
  if (Number(row?.rated)) {
    result.primaryAvg = round(num(row.avg));
    result.satisfactionRate = round(Number(row.satisfied) / Number(row.rated), 4);
  }
  return result;
}

const bkkDate = (date) => new Date(date.getTime() + BKK_OFFSET_MS).toISOString().slice(0, 10);

async function computeStats({ surveyId, branchId, channel = null, range }) {
  // ดูรายสาขา → ใช้ฟอร์มของสาขานั้น (ถ้าสาขามีฟอร์มของตัวเอง) | ดูรวม → ฟอร์มกลาง
  const version = await getLatestVersion(surveyId, { branchId });
  // กรองช่องทาง: เห็นเฉพาะคำถามของช่องทางนั้น (ข้อที่ใช้ทั้งสองช่องทางรวมอยู่ด้วย)
  const questions = (version?.questions ?? []).filter((q) => !channel || inChannel(q, channel));
  const ratingQs = questions.filter((q) => q.type === 'rating');
  const textQs = questions.filter((q) => q.type === 'long_text' || q.type === 'short_text');
  const primary = ratingQs.find((q) => q.key === 'overall_satisfaction') ?? ratingQs.at(-1) ?? null;
  const filters = { surveyId, branchId, channel, from: rangeStart(range) };
  const channels = channel ? [channel] : CHANNELS;

  const base = () =>
    applyFilters(db('answers as a').join('responses as r', 'r.id', 'a.response_id'), filters);

  const [{ n: totalResponses }] = await applyFilters(db('responses as r').count({ n: '*' }), filters);

  const perQuestion = await base()
    .whereNotNull('a.value_number')
    .groupBy('a.question_key')
    .select('a.question_key')
    .avg({ avg: 'a.value_number' })
    .count({ n: '*' });
  const perQuestionMap = new Map(perQuestion.map((r) => [r.question_key, r]));

  const distRows = primary
    ? await base()
        .where('a.question_key', primary.key)
        .whereNotNull('a.value_number')
        .groupBy('a.value_number')
        .select('a.value_number as score')
        .count({ n: '*' })
    : [];
  const distMap = new Map(distRows.map((r) => [Number(r.score), Number(r.n)]));
  const min = primary?.config?.min ?? 1;
  const max = primary?.config?.max ?? 5;
  const distribution = [];
  for (let s = min; s <= max; s++) distribution.push({ score: s, count: distMap.get(s) ?? 0 });

  // การกระจายคะแนนของทุกหัวข้อแบบให้คะแนน (จำนวนคนที่ให้แต่ละดาว) แยกตามช่องทาง — ใช้กับกราฟรายหัวข้อบน Dashboard
  const qDistRows = ratingQs.length
    ? await base()
        .whereIn('a.question_key', ratingQs.map((q) => q.key))
        .whereNotNull('a.value_number')
        .groupBy('r.channel', 'a.question_key', 'a.value_number')
        .select('r.channel', 'a.question_key', 'a.value_number as score')
        .count({ n: '*' })
    : [];
  const qDistMap = new Map();
  for (const r of qDistRows) {
    for (const key of [`${r.channel}|${r.question_key}|${Number(r.score)}`, `*|${r.question_key}|${Number(r.score)}`]) {
      qDistMap.set(key, (qDistMap.get(key) ?? 0) + Number(r.n));
    }
  }
  const questionDistribution = (q, ch = '*') => {
    const lo = q.config?.min ?? 1;
    const hi = q.config?.max ?? 5;
    return Array.from({ length: hi - lo + 1 }, (_, i) => ({ score: lo + i, count: qDistMap.get(`${ch}|${q.key}|${lo + i}`) ?? 0 }));
  };
  const distSummary = (q, ch) => {
    const dist = questionDistribution(q, ch);
    const n = dist.reduce((a, d) => a + d.count, 0);
    return { key: q.key, label: q.label, min: q.config?.min ?? 1, max: q.config?.max ?? 5, n, avg: n ? round(dist.reduce((a, d) => a + d.score * d.count, 0) / n) : null, distribution: dist };
  };
  const distributionByChannel = channels.map((ch) => ({ channel: ch, label: CHANNEL_LABELS[ch], questions: ratingQs.filter((q) => inChannel(q, ch)).map((q) => distSummary(q, ch)) }));

  const ratedTotal = distribution.reduce((a, d) => a + d.count, 0);
  const satisfied = distribution.filter((d) => d.score >= max - 1).reduce((a, d) => a + d.count, 0);

  const trendRows = await applyFilters(
    db('responses as r')
      .leftJoin('answers as a', function join() {
        this.on('a.response_id', 'r.id').andOn('a.question_key', db.raw('?', [primary?.key ?? '']));
      })
      .select(db.raw("DATE(CONVERT_TZ(r.submitted_at, '+00:00', '+07:00')) as day"))
      .count({ n: db.raw('DISTINCT r.id') })
      .avg({ avg: 'a.value_number' })
      .groupByRaw("DATE(CONVERT_TZ(r.submitted_at, '+00:00', '+07:00'))")
      .orderBy('day'),
    filters,
  );

  // ช่วงก่อนหน้า (ความยาวเท่ากัน) สำหรับเทียบ — ไม่มีเมื่อเลือก "ทั้งหมด"
  const rangeDays = RANGES[normalizeRange(range)];
  const previous =
    rangeDays && filters.from
      ? await periodTotals({ surveyId, branchId, channel, from: new Date(filters.from.getTime() - rangeDays * 86_400_000), to: filters.from }, primary)
      : null;

  // ความหนาแน่นของรีวิว 7 วันล่าสุด x 24 ชั่วโมง (เวลาไทย) สำหรับ minimap
  const activityFrom = rangeStart('7d');
  const activityRows = await applyFilters(db('responses as r'), { surveyId, branchId, channel, from: activityFrom })
    .select(
      db.raw("DATE(CONVERT_TZ(r.submitted_at, '+00:00', '+07:00')) as day"),
      db.raw("HOUR(CONVERT_TZ(r.submitted_at, '+00:00', '+07:00')) as hour"),
    )
    .count({ n: '*' })
    .groupByRaw("DATE(CONVERT_TZ(r.submitted_at, '+00:00', '+07:00')), HOUR(CONVERT_TZ(r.submitted_at, '+00:00', '+07:00'))");
  const activityMap = new Map(
    activityRows.map((r) => [`${typeof r.day === 'string' ? r.day.slice(0, 10) : new Date(r.day).toISOString().slice(0, 10)}|${Number(r.hour)}`, Number(r.n)]),
  );
  const activity = Array.from({ length: 7 }, (_, i) => {
    const date = bkkDate(new Date(activityFrom.getTime() + i * 86_400_000));
    return { date, hours: Array.from({ length: 24 }, (_, h) => activityMap.get(`${date}|${h}`) ?? 0) };
  });

  const matrixRows = await base()
    .whereNotNull('a.value_number')
    .groupBy('r.branch_id', 'a.question_key')
    .select('r.branch_id', 'a.question_key')
    .avg({ avg: 'a.value_number' })
    .count({ n: '*' });

  const branchCounts = await applyFilters(db('responses as r').groupBy('r.branch_id').select('r.branch_id').count({ n: '*' }), filters);

  const allBranches = await db('branches').orderBy('code');
  const branchRows = branchId ? allBranches.filter((b) => b.id === branchId) : allBranches;

  const branches = branchRows.map((b) => {
    const scores = {};
    for (const row of matrixRows.filter((m) => m.branch_id === b.id)) {
      scores[row.question_key] = { avg: round(num(row.avg)), n: Number(row.n) };
    }
    const count = branchCounts.find((c) => c.branch_id === b.id);
    return { id: b.id, code: b.code, name: b.name, isActive: !!b.is_active, responses: Number(count?.n ?? 0), scores };
  });

  // "ดาวรวม" ต่อสาขา = เฉลี่ยทุกคะแนนดาวของสาขานั้น (ทุกหัวข้อ) — เทียบข้ามสาขาได้แม้แต่ละสาขาใช้ฟอร์มต่างกัน
  const starRows = await base()
    .whereNotNull('a.value_number')
    .groupBy('r.branch_id', db.raw('ROUND(a.value_number)'))
    .select('r.branch_id', db.raw('ROUND(a.value_number) as score'))
    .count({ n: '*' });
  const branchStars = branches
    .map((b) => {
      const dist = [5, 4, 3, 2, 1].map((s) => ({ score: s, count: starRows.filter((r) => r.branch_id === b.id && Number(r.score) === s).reduce((a, r) => a + Number(r.n), 0) }));
      const ratings = dist.reduce((a, d) => a + d.count, 0);
      return { id: b.id, name: b.name, isActive: b.isActive, responses: b.responses, ratings, avg: ratings ? round(dist.reduce((a, d) => a + d.score * d.count, 0) / ratings) : null, distribution: dist };
    })
    .filter((b) => b.responses > 0 || b.isActive)
    .sort((x, y) => (y.avg ?? -1) - (x.avg ?? -1) || y.responses - x.responses);

  const attention = [];
  for (const b of branches) {
    for (const q of ratingQs) {
      const s = b.scores[q.key];
      if (s && s.n >= ATTENTION_MIN_RESPONSES && s.avg < ATTENTION_THRESHOLD) {
        attention.push({ branch: b.name, branchId: b.id, question: q.label, key: q.key, avg: s.avg, n: s.n });
      }
    }
  }
  attention.sort((x, y) => x.avg - y.avg);

  let comments = [];
  if (textQs.length) {
    const rows = await base()
      .whereIn('a.question_key', textQs.map((q) => q.key))
      .whereNotNull('a.value_text')
      .orderBy('r.submitted_at', 'desc')
      .limit(20)
      .select('r.id as response_id', 'r.submitted_at', 'r.branch_id', 'r.channel', 'a.question_key', 'a.value_text');
    const scores = primary && rows.length
      ? await db('answers').whereIn('response_id', rows.map((r) => r.response_id)).where({ question_key: primary.key }).select('response_id', 'value_number')
      : [];
    const scoreMap = new Map(scores.map((s) => [s.response_id, num(s.value_number)]));
    const labelMap = new Map(textQs.map((q) => [q.key, q.label]));
    const branchMap = new Map(branchRows.map((b) => [b.id, b.name]));
    comments = rows.map((r) => ({
      id: r.response_id,
      submittedAt: new Date(r.submitted_at).toISOString(),
      branch: branchMap.get(r.branch_id) ?? null,
      channel: r.channel,
      question: labelMap.get(r.question_key),
      score: scoreMap.get(r.response_id) ?? null,
      text: r.value_text,
    }));
  }

  return {
    range: normalizeRange(range),
    channel,
    generatedAt: new Date().toISOString(),
    totals: {
      responses: Number(totalResponses),
      satisfactionRate: ratedTotal ? round(satisfied / ratedTotal, 4) : null,
      primaryAvg: primary ? round(num(perQuestionMap.get(primary.key)?.avg)) : null,
    },
    previous,
    activity,
    primary: primary ? { key: primary.key, label: primary.label, min, max } : null,
    questions: ratingQs.map((q) => ({
      key: q.key,
      label: q.label,
      avg: round(num(perQuestionMap.get(q.key)?.avg)),
      n: Number(perQuestionMap.get(q.key)?.n ?? 0),
      min: q.config?.min ?? 1,
      max: q.config?.max ?? 5,
      distribution: questionDistribution(q),
    })),
    distribution,
    distributionByChannel,
    trend: trendRows.map((r) => ({
      date: typeof r.day === 'string' ? r.day.slice(0, 10) : new Date(r.day).toISOString().slice(0, 10),
      count: Number(r.n),
      avg: round(num(r.avg)),
    })),
    branches,
    branchStars,
    branchOptions: allBranches.filter((b) => b.is_active).map((b) => ({ id: b.id, name: b.name })),
    attention,
    comments,
  };
}

// แคชในหน่วยความจำ (คำนวณเมื่อมีคนเปิดเท่านั้น ไม่ polling) — ลดการใช้ Request Unit ของ TiDB
const cache = new Map();
const CACHE_MAX = 200;

export async function getStats(params, { ttlSec = config.DASHBOARD_CACHE_TTL_SEC } = {}) {
  const range = normalizeRange(params.range);
  const key = `${params.surveyId}|${params.branchId ?? ''}|${params.channel ?? ''}|${range}`;
  const hit = cache.get(key);
  if (ttlSec > 0 && hit && hit.expires > Date.now()) return hit.value;

  const value = await computeStats({ ...params, range });
  if (ttlSec > 0) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: Date.now() + ttlSec * 1000 });
  }
  return value;
}

export function clearStatsCache() {
  cache.clear();
}

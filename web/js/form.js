import { api, ApiError } from './api.js';
import { h, clear, tokenFromPath, svg } from './util.js';
import { initEffects } from './ui/motion.js';

initEffects();

const app = document.getElementById('app');
const token = tokenFromPath();

// byChannel = มีเมื่อเป็น QR แบบ "ลูกค้าเลือกเอง": คำถามของแต่ละช่องทาง (ลูกค้าเลือกก่อนแล้วค่อยตอบ)
const state = { survey: null, branch: null, channel: null, byChannel: null, questions: [], settings: {}, answers: {}, index: 0, website: '', submitting: false };
const CHANNEL_LABELS = { store: 'หน้าร้าน', online: 'ออนไลน์' };
const CHANNEL_CHOICES = [
  { value: 'store', icon: 'store', title: 'ซื้อที่หน้าร้าน', hint: 'มาที่ร้านด้วยตัวเอง' },
  { value: 'online', icon: 'delivery', title: 'สั่งออนไลน์ / เดลิเวอรี่', hint: 'สั่งผ่านแอป แชต หรือโทรสั่ง' },
];

// ไอคอนเส้น (stroke = สีตัวอักษร) แทนอีโมจิ — หน้าตาเหมือนกันทุกมือถือและเข้ากับธีม
const ICONS = {
  // หน้าร้าน: กันสาดลอนคลื่น + ตัวร้าน + ประตู
  store: [
    { tag: 'path', d: 'M3.5 10 5 5h14l1.5 5' },
    { tag: 'path', d: 'M3.5 10a2.13 2.13 0 0 0 4.25 0a2.13 2.13 0 0 0 4.25 0a2.13 2.13 0 0 0 4.25 0a2.13 2.13 0 0 0 4.25 0' },
    { tag: 'path', d: 'M5 12.6V20h14v-7.4' },
    { tag: 'path', d: 'M10 20v-4.5h4V20' },
  ],
  // เดลิเวอรี่: มอเตอร์ไซค์ + กล่องส่งของด้านหลัง
  delivery: [
    { tag: 'circle', cx: 6, cy: 17, r: 2.5 },
    { tag: 'circle', cx: 18, cy: 17, r: 2.5 },
    { tag: 'path', d: 'M8.5 17h5.5l2.2-6.5h2.3' },
    { tag: 'path', d: 'M16.2 10.5 15.4 7H18' },
    { tag: 'path', d: 'M18.5 10.5 20 14.6' },
    { tag: 'path', d: 'M3.5 15 5 12.5h6' },
    { tag: 'rect', x: 3, y: 5.5, width: 6.5, height: 5, rx: 1 },
  ],
};
const icon = (name) =>
  svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, ICONS[name].map(({ tag, ...attrs }) => svg(tag, attrs)));

// ตัดบรรทัดภาษาไทยให้ขาดเฉพาะระหว่างวลี: แบ่งคำด้วย Intl.Segmenter แล้วรวมคำสั้นเข้ากับคำข้างๆ
// - คำสั้น (≤ 3 ตัวอักษรหลัก เช่น "งาน" "นี้" "ใด" "ชาติ") ต่อท้ายคำก่อนหน้า → "ทีมงาน" "มื้อนี้" "รสชาติ" ไม่ขาด
// - คำนำหน้า (ของ ที่ การ ใน จะ …) ต่อกับคำถัดไป → "ของคุณ" "การดูแล"
// ห้ามตัดกลางวลี (<wbr> = จุดที่ตัดได้) · ชื่อร้านอยู่บรรทัดเดียวเสมอ · ไม่พึ่งตัวตัดคำของเบราว์เซอร์ (แอป LINE บางรุ่นตัดไม่ดี)
// คำ/ชื่อที่ตัวแบ่งคำมักผ่ากลาง — ให้อยู่ด้วยกันเสมอ
const KEEP_TOGETHER = ['เหนียวหมูไส้แตก', 'พึงพอใจ', 'ทีมงาน', 'ข้าวเหนียว', 'ตรงต่อเวลา', 'บรรจุภัณฑ์', 'เรียบร้อย', 'สั่งซื้อ', 'สั่งอาหาร', 'ข้อเสนอแนะ'];
const JOIN_NEXT = new Set(['การ', 'ความ', 'ของ', 'ใน', 'ที่', 'จะ', 'อีก', 'ได้', 'ให้', 'ไม่', 'กับ', 'และ', 'หรือ', 'เพื่อ', 'จาก', 'ทุก', 'เมื่อ', 'ถ้า', 'แต่', 'ซึ่ง', 'โดย', 'ตาม']);
const MAX_PHRASE = 22; // วลีไม่ยาวเกินนี้ (ตัวอักษร) กันล้นจอมือถือแคบ
const baseLen = (t) => t.replace(/[ัิ-ฺ็-๎]/g, '').length; // ไม่นับสระบน/ล่าง วรรณยุกต์
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
function thaiPhrases(text) {
  const chunks = []; // { t, word }
  for (const part of String(text ?? '').split(new RegExp(`(${KEEP_TOGETHER.join('|')})`))) {
    if (!part) continue;
    if (KEEP_TOGETHER.includes(part) || !segmenter) chunks.push({ t: part, word: KEEP_TOGETHER.includes(part), keep: true });
    else for (const { segment, isWordLike } of segmenter.segment(part)) chunks.push({ t: segment, word: isWordLike });
  }
  const groups = [];
  let glue = false; // คำก่อนหน้าเป็นคำนำหน้า → ต่อกับคำนี้
  for (const c of chunks) {
    const last = groups.at(-1);
    const prefix = c.word && JOIN_NEXT.has(c.t);
    const short = c.word && !c.keep && !prefix && baseLen(c.t) <= 3;
    if (c.word && last?.word && (glue || short) && last.t.length + c.t.length <= MAX_PHRASE) last.t += c.t;
    else groups.push({ ...c });
    glue = prefix;
  }
  return groups;
}
const thai = (text) => thaiPhrases(text).flatMap((g) => (g.word ? [h('span', { class: 'nobr' }, g.t), h('wbr')] : [g.t]));

function notice(title, text) {
  clear(app).append(h('div', { class: 'notice' }, h('h1', {}, title), h('p', { class: 'muted' }, text)));
}

async function init() {
  try {
    const data = await api(`/r/${encodeURIComponent(token)}`);
    Object.assign(state, { survey: data.survey, branch: data.branch, channel: data.channel ?? null, questions: data.questions, settings: data.settings ?? {} });
    document.title = data.survey.title;
    if (data.channelChoice) {
      // แสดงเฉพาะช่องทางที่มีคำถาม — ถ้าเหลือช่องทางเดียวก็ข้ามหน้าเลือกไปเลย
      const usable = CHANNEL_CHOICES.filter((c) => data.questionsByChannel?.[c.value]?.length);
      state.byChannel = data.questionsByChannel;
      state.channel = null; // data.channel = ค่าสำรองสำหรับหน้าเว็บเก่า — หน้าเลือกต้องยังไม่เลือกอะไร
      if (usable.length === 1) return pickChannel(usable[0].value);
      if (usable.length > 1) return renderChooser(usable);
    }
    render();
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notice('ลิงก์นี้ใช้งานไม่ได้', 'ลิงก์อาจหมดอายุหรือถูกยกเลิกแล้ว กรุณาสแกน QR code ใหม่ หรือสอบถามพนักงาน');
    else if (err instanceof ApiError && err.status === 429) notice('มีการใช้งานหนาแน่น', 'กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
    else notice('เชื่อมต่อไม่ได้', 'กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง');
  }
}

const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

// โลโก้แบรนด์ (ไฟล์ web/img/logo.png ขนาด 360×252 — ใส่ width/height กันหน้ากระตุกตอนโหลด)
const logo = () => h('img', { class: 'logo', src: '/img/logo.png', alt: 'เหนียวหมูไส้แตก', width: 360, height: 252, decoding: 'async' });

function header() {
  const total = state.questions.length;
  const bar = h('i');
  bar.style.width = `${(state.index / total) * 100}%`;
  return h(
    'header',
    { class: 'top' },
    logo(),
    h('p', { class: 'eyebrow' }, state.branch ? state.branch.name : state.survey.title),
    h('p', { class: 'brand' }, [state.branch ? state.survey.title : '', CHANNEL_LABELS[state.channel]].filter(Boolean).join(' · ')),
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': state.index }, bar),
    h('p', { class: 'step-count' }, `${String(state.index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`),
  );
}

// หมูให้คะแนน = หมูตัวเดียวกับในโลโก้ (web/img/pig.png ตัดจากโลโก้ 160×160)
// ยังไม่เลือก = สีเทาจาง, เลือกแล้ว = สีจริง + พื้นวงกลมชมพู (ต่างกันทั้งสีและความเข้ม ไม่ใช่สีอย่างเดียว)
const pigIcon = () => h('img', { class: 'pig', src: '/img/pig.png', alt: '', width: 160, height: 160, decoding: 'async', draggable: 'false' });

function renderRating(q, onChange) {
  const { min = 1, max = 5, labels = {} } = q.config ?? {};
  const current = state.answers[q.key] ?? 0;
  const wrap = h('div', { class: 'stars', role: 'radiogroup', 'aria-label': q.label });
  const stars = [];
  for (let v = min; v <= max; v++) {
    const id = `${q.key}-${v}`;
    const input = h('input', { type: 'radio', name: q.key, id, value: v, checked: current === v, 'aria-label': `${v} คะแนน` });
    const star = h('div', { class: `star${v <= current ? ' on' : ''}` }, input, h('label', { for: id, 'aria-hidden': 'true' }, pigIcon()));
    input.addEventListener('change', () => {
      // เติมสีทันทีทีละตัว (หมูเด้งไล่จากตัวแรก) ก่อนค่อยไปข้อถัดไป
      stars.forEach((s, i) => {
        s.classList.toggle('on', i + min <= v);
        s.classList.remove('pop');
        s.style.removeProperty('--d');
      });
      void wrap.offsetWidth; // ให้แอนิเมชันเริ่มใหม่ได้ทุกครั้งที่เลือก
      stars.forEach((s, i) => {
        if (i + min > v) return;
        s.style.setProperty('--d', i);
        s.classList.add('pop');
      });
      onChange(v);
    });
    stars.push(star);
    wrap.append(star);
  }
  return h('div', {}, wrap, h('div', { class: 'scale-hint' }, h('span', {}, labels[min] ?? ''), h('span', {}, labels[max] ?? '')));
}

function renderChoice(q, multiple, onChange) {
  const options = q.config?.options ?? [];
  const current = state.answers[q.key] ?? (multiple ? [] : null);
  const wrap = h('div', { class: 'choices' });
  options.forEach((opt, i) => {
    const id = `${q.key}-${i}`;
    const checked = multiple ? current.includes(opt.value) : current === opt.value;
    const input = h('input', { type: multiple ? 'checkbox' : 'radio', name: q.key, id, value: opt.value, checked });
    input.addEventListener('change', () => {
      if (!multiple) return onChange(opt.value);
      const set = new Set(state.answers[q.key] ?? []);
      input.checked ? set.add(opt.value) : set.delete(opt.value);
      onChange([...set]);
    });
    wrap.append(h('div', { class: 'choice' }, input, h('label', { for: id }, opt.label)));
  });
  return wrap;
}

function renderText(q, long, onInput) {
  const max = Number(q.config?.maxLength) || (long ? 1000 : 200);
  const input = h(long ? 'textarea' : 'input', { id: q.key, maxlength: max, placeholder: q.config?.placeholder ?? '', 'aria-label': q.label, ...(long ? { rows: 5 } : { type: 'text' }) });
  input.value = state.answers[q.key] ?? '';
  const counter = h('div', { class: 'counter' }, `${input.value.length}/${max}`);
  input.addEventListener('input', () => {
    counter.textContent = `${input.value.length}/${max}`;
    onInput(input.value);
  });
  return h('div', {}, input, counter);
}

let advanceTimer = null;

/** หน้าแรกของ QR แบบเลือกเอง: "ครั้งนี้สั่งแบบไหน?" — ปุ่มใหญ่กดง่ายบนมือถือ */
function renderChooser(choices = CHANNEL_CHOICES.filter((c) => state.byChannel?.[c.value]?.length)) {
  clearTimeout(advanceTimer);
  const buttons = choices.map((c) =>
    h(
      'button',
      { type: 'button', class: `pick${state.channel === c.value ? ' on' : ''}`, onclick: () => pickChannel(c.value) },
      h('span', { class: 'pick-icon', 'aria-hidden': 'true' }, icon(c.icon)),
      h('span', { class: 'pick-text' }, h('b', {}, c.title), h('small', {}, c.hint)),
      h('span', { class: 'pick-arrow', 'aria-hidden': 'true' }, '›'),
    ),
  );
  clear(app).append(
    h(
      'div',
      { class: 'card-like chooser' },
      h('header', { class: 'top' }, logo(), h('p', { class: 'eyebrow' }, state.branch ? state.branch.name : state.survey.title), h('p', { class: 'brand' }, state.branch ? state.survey.title : '')),
      h('div', { class: 'q-wrap' }, h('div', { class: 'question q-enter', role: 'group', 'aria-labelledby': 'pick-title' }, h('h1', { class: 'pick-title', id: 'pick-title' }, thai('ครั้งนี้สั่งแบบไหน?')), h('div', { class: 'picks' }, buttons))),
    ),
  );
}

function pickChannel(channel) {
  if (state.channel !== channel) state.index = 0;
  state.channel = channel;
  state.questions = state.byChannel[channel];
  render();
}

function render() {
  clearTimeout(advanceTimer);
  const q = state.questions[state.index];
  const last = state.index === state.questions.length - 1;
  const errorBox = h('p', { class: 'field-error', role: 'alert' });

  const setAnswer = (value) => {
    state.answers[q.key] = value;
    errorBox.textContent = '';
  };

  let body;
  if (q.type === 'rating') {
    body = renderRating(q, (v) => {
      setAnswer(v);
      // ให้คะแนนแล้วไปข้อถัดไปเอง (ข้อสุดท้ายรอให้กดส่ง) — เว้นจังหวะให้เห็นหมูเด้งก่อน
      clearTimeout(advanceTimer);
      if (!last) advanceTimer = setTimeout(() => go(1), 650);
    });
  } else if (q.type === 'single_choice') {
    body = renderChoice(q, false, (v) => {
      setAnswer(v);
      clearTimeout(advanceTimer);
      if (!last) advanceTimer = setTimeout(() => go(1), 260);
    });
  } else if (q.type === 'multi_choice') {
    body = renderChoice(q, true, setAnswer);
  } else {
    body = renderText(q, q.type === 'long_text', setAnswer);
  }

  // หัวข้อ (ไม่บังคับ เช่น "รสชาติ") อยู่เหนือเนื้อเรื่องคำถาม
  const title = h(
    'legend',
    {},
    q.title ? h('span', { class: 'q-title' }, thai(q.title)) : null,
    h('span', { class: 'q-text' }, thai(q.label), q.required ? h('span', { class: 'req', 'aria-label': 'จำเป็น' }, '*') : null),
  );
  const honeypot = h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', {}, 'อย่ากรอกช่องนี้', h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', oninput: (e) => (state.website = e.target.value) })));

  // ข้อแรกของ QR แบบเลือกเอง: ย้อนกลับไปเปลี่ยนช่องทางได้
  const back =
    state.index > 0
      ? h('button', { type: 'button', class: 'btn ghost', onclick: () => go(-1) }, '‹ ย้อนกลับ')
      : state.byChannel
        ? h('button', { type: 'button', class: 'btn ghost', onclick: () => renderChooser() }, '‹ เปลี่ยนช่องทาง')
        : null;
  const skippable = !q.required && !last && q.type === 'rating';
  const next = h(
    'button',
    { type: 'submit', class: 'btn primary', id: 'next' },
    last ? 'ส่งความคิดเห็น' : skippable && isEmpty(state.answers[q.key]) ? 'ข้าม' : 'ถัดไป ›',
  );

  const form = h('form', { class: 'card-like', novalidate: true }, header(), h('div', { class: 'q-wrap' }, h('fieldset', { class: 'question q-enter' }, title, body, errorBox)), honeypot, h('div', { class: 'nav' }, back, next));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.submitting) return;
    if (q.required && isEmpty(state.answers[q.key])) {
      errorBox.textContent = q.type === 'rating' ? 'กรุณาเลือกคะแนน' : 'กรุณาตอบข้อนี้';
      return;
    }
    last ? submit(next, errorBox) : go(1);
  });

  clear(app).append(form);
}

function go(delta) {
  state.index = Math.min(Math.max(state.index + delta, 0), state.questions.length - 1);
  render();
}

async function submit(button, errorBox) {
  state.submitting = true;
  button.disabled = true;
  button.textContent = 'กำลังส่ง…';
  try {
    // ส่งเฉพาะคำตอบของคำถามในช่องทางที่เลือก (ถ้าลูกค้าเปลี่ยนช่องทางกลางทาง คำตอบเก่าของอีกช่องทางไม่ติดไป)
    const keys = new Set(state.questions.map((q) => q.key));
    const answers = Object.fromEntries(Object.entries(state.answers).filter(([k]) => keys.has(k)));
    const body = { answers, website: state.website, ...(state.byChannel ? { channel: state.channel } : {}) };
    const result = await api(`/r/${encodeURIComponent(token)}/submit`, { method: 'POST', body });
    done({ ...state.settings, thankYou: result.thankYou ?? state.settings.thankYou });
  } catch (err) {
    state.submitting = false;
    button.disabled = false;
    button.textContent = 'ส่งความคิดเห็น';
    if (err instanceof ApiError && err.status === 422) {
      // ข้อที่ผิด/ขาด → พาไปข้อนั้น
      const firstBad = state.questions.findIndex((q) => err.body?.fields?.[q.key]);
      if (firstBad >= 0) {
        state.index = firstBad;
        render();
        document.querySelector('.field-error').textContent = 'กรุณาตรวจสอบคำตอบข้อนี้';
        return;
      }
    }
    errorBox.textContent =
      err instanceof ApiError && err.status === 429
        ? 'ส่งบ่อยเกินไป กรุณารอสักครู่แล้วลองอีกครั้ง'
        : err instanceof ApiError && err.status === 404
          ? 'ลิงก์นี้หมดอายุแล้ว'
          : 'ส่งไม่สำเร็จ กรุณาลองอีกครั้ง';
  }
}

// ข้อความหลังส่ง (แอดมินแก้ได้ที่หน้าแก้ไขคำถาม) — ค่าเริ่มต้นเมื่อฟอร์มยังไม่ได้ตั้ง
const DONE_DEFAULTS = {
  sentTitle: 'ส่งความคิดเห็นเรียบร้อยแล้ว 💚',
  thanksTitle: 'ขอบคุณที่ให้เหนียวหมูไส้แตกดูแลมื้อนี้ของคุณ',
  thankYou: 'ความคิดเห็นของคุณจะช่วยให้เราปรับปรุงอาหารและบริการให้ดียิ่งขึ้น หวังว่าจะได้ดูแลคุณอีกครั้งในมื้อถัดไปนะคะ',
};
const SENT_MS = 1800;

/** หลังส่ง: หน้า "ส่งเรียบร้อย" สั้นๆ แล้วเด้งไปหน้าขอบคุณสุดท้าย */
function done(settings = {}) {
  const text = (k) => settings[k]?.trim() || DONE_DEFAULTS[k];
  const tick = h('div', { class: 'tick', 'aria-hidden': 'true' }, svg('svg', { viewBox: '0 0 24 24', fill: 'none', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg('path', { d: 'M5 12.5l4.5 4.5L19 7.5' })));
  clear(app).append(h('div', { class: 'done card-like' }, h('div', { class: 'q-enter' }, tick, h('h1', { class: 'sent-title' }, thai(text('sentTitle'))))));
  setTimeout(() => {
    clear(app).append(h('div', { class: 'done card-like' }, h('div', { class: 'q-enter' }, logo(), h('h1', { class: 'grad-text thanks-title' }, thai(text('thanksTitle'))), h('p', { class: 'thanks-text' }, thai(text('thankYou'))))));
  }, SENT_MS);
}

init();

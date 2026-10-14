import { api, ApiError } from './api.js';
import { h, clear, tokenFromPath, svg } from './util.js';
import { initEffects } from './ui/motion.js';

initEffects();

const app = document.getElementById('app');
const token = tokenFromPath();

const state = { survey: null, branch: null, questions: [], settings: {}, answers: {}, index: 0, website: '', submitting: false };

function notice(title, text) {
  clear(app).append(h('div', { class: 'notice' }, h('h1', {}, title), h('p', { class: 'muted' }, text)));
}

async function init() {
  try {
    const data = await api(`/r/${encodeURIComponent(token)}`);
    Object.assign(state, { survey: data.survey, branch: data.branch, questions: data.questions, settings: data.settings ?? {} });
    document.title = data.survey.title;
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
    h('p', { class: 'brand' }, state.branch ? state.survey.title : ''),
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': state.index }, bar),
    h('p', { class: 'step-count' }, `${String(state.index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`),
  );
}

// ดาว 5 แฉก: ยังไม่เลือก = เส้นขอบ, เลือกแล้ว = เติมสี (ต่างกันที่รูปทรง ไม่ใช่สีอย่างเดียว)
const STAR_PATH = 'M12 2.6l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17.4 6 20.7l1.3-6.6L2.4 9.5l6.7-.8z';

function renderRating(q, onChange) {
  const { min = 1, max = 5, labels = {} } = q.config ?? {};
  const current = state.answers[q.key] ?? 0;
  const wrap = h('div', { class: 'stars', role: 'radiogroup', 'aria-label': q.label });
  const stars = [];
  for (let v = min; v <= max; v++) {
    const id = `${q.key}-${v}`;
    const input = h('input', { type: 'radio', name: q.key, id, value: v, checked: current === v, 'aria-label': `${v} คะแนน` });
    const icon = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: STAR_PATH }));
    const star = h('div', { class: `star${v <= current ? ' on' : ''}` }, input, h('label', { for: id, 'aria-hidden': 'true' }, icon));
    input.addEventListener('change', () => {
      // เติมสีทันทีทีละดวง (ดาวเด้งไล่จากดวงแรก) ก่อนค่อยไปข้อถัดไป
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
      // ให้คะแนนแล้วไปข้อถัดไปเอง (ข้อสุดท้ายรอให้กดส่ง) — เว้นจังหวะให้เห็นดาวเด้งก่อน
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

  const title = h('legend', {}, q.label, q.required ? h('span', { class: 'req', 'aria-label': 'จำเป็น' }, '*') : null);
  const honeypot = h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', {}, 'อย่ากรอกช่องนี้', h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', oninput: (e) => (state.website = e.target.value) })));

  const back = state.index > 0 ? h('button', { type: 'button', class: 'btn ghost', onclick: () => go(-1) }, '‹ ย้อนกลับ') : null;
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
    const result = await api(`/r/${encodeURIComponent(token)}/submit`, { method: 'POST', body: { answers: state.answers, website: state.website } });
    done(result.thankYou ?? state.settings.thankYou);
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

function done(message) {
  clear(app).append(
    h('div', { class: 'done card-like' }, logo(), h('div', { class: 'tick', 'aria-hidden': 'true' }, svg('svg', { viewBox: '0 0 24 24', fill: 'none', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg('path', { d: 'M5 12.5l4.5 4.5L19 7.5' }))), h('h1', { class: 'grad-text' }, 'ขอบคุณค่ะ/ครับ'), h('p', { class: 'muted' }, message || 'ขอบคุณสำหรับความคิดเห็นของคุณ')),
  );
}

init();

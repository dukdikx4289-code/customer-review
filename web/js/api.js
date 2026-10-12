// เรียก API ผ่านโดเมนเดียวกัน (ใน production Vercel rewrite /api/* ไป Render จึงไม่ต้องใช้ CORS)
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `http_${status}`);
    this.status = status;
    this.body = body;
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, { error: 'network' });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

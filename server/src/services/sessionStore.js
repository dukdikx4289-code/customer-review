import session from 'express-session';

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

// session store บน Knex (ตาราง sessions) — เขียนเองแทน express-mysql-session
// เพราะแพ็กเกจนั้นพ่วง mysql2 รุ่นเก่าที่มีช่องโหว่ติดมาด้วย
export class KnexSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    // ล้าง session หมดอายุทุกชั่วโมง (unref เพื่อไม่ให้ค้าง process)
    this.timer = setInterval(() => this.db('sessions').where('expires_at', '<', this.db.fn.now(3)).del().catch(() => {}), 3_600_000);
    this.timer.unref();
  }

  expiry(sess) {
    const at = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + DEFAULT_TTL_MS;
    return new Date(at);
  }

  get(sid, cb) {
    this.db('sessions')
      .where({ sid })
      .where('expires_at', '>', this.db.fn.now(3))
      .first()
      .then((row) => cb(null, row ? JSON.parse(row.sess) : null))
      .catch(cb);
  }

  set(sid, sess, cb) {
    const row = { sid, sess: JSON.stringify(sess), expires_at: this.expiry(sess) };
    this.db('sessions')
      .insert(row)
      .onConflict('sid')
      .merge(['sess', 'expires_at'])
      .then(() => cb?.(null))
      .catch((err) => cb?.(err));
  }

  touch(sid, sess, cb) {
    this.db('sessions')
      .where({ sid })
      .update({ expires_at: this.expiry(sess) })
      .then(() => cb?.(null))
      .catch((err) => cb?.(err));
  }

  destroy(sid, cb) {
    this.db('sessions')
      .where({ sid })
      .del()
      .then(() => cb?.(null))
      .catch((err) => cb?.(err));
  }
}

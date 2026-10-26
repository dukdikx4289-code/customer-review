// GET /api/r/:token → rewrite มาที่นี่ (?token=) ใน vercel.json — คำถามของฟอร์มลูกค้า (ดู api/_lib/form.js)
import { formHandler } from './_lib/form.js';

export default formHandler('load');

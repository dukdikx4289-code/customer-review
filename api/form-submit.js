// POST /api/r/:token/submit → rewrite มาที่นี่ (?token=) ใน vercel.json — บันทึกคำตอบลูกค้า (ดู api/_lib/form.js)
import { formHandler } from './_lib/form.js';

export default formHandler('submit');

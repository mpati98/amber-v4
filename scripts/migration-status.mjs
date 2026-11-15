// Trạng thái migration của một DB — CHỈ ĐỌC (giao dịch READ ONLY), không in chuỗi kết nối.
//   node scripts/migration-status.mjs                 → DATABASE_URL (Neon DEV)
//   node scripts/migration-status.mjs PRODUCTION      → DATABASE_URL_PRODUCTION (endpoint phải là ep-divine-feather-b3zba6y0)
// In: endpoint, số migration đã áp / số file trong drizzle/, migration nào còn treo, dấu hiệu từng migration 0013–0017,
// và dữ liệu Học tập cũ (0014 tự dừng nếu còn), số dư ví (để so trước / sau khi migrate).
import 'dotenv/config';
import fs from 'node:fs';
import postgres from 'postgres';

const prod = process.argv[2] === 'PRODUCTION';
const url = prod ? process.env.DATABASE_URL_PRODUCTION : process.env.DATABASE_URL;
if (!url) { console.error(`Thiếu ${prod ? 'DATABASE_URL_PRODUCTION' : 'DATABASE_URL'}`); process.exit(2); }
const endpoint = new URL(url).hostname.split('.')[0];
console.log(`DB: ${prod ? 'PRODUCTION' : 'DATABASE_URL'} · endpoint ${endpoint}`);
if (prod && !endpoint.startsWith('ep-divine-feather-b3zba6y0')) { console.error('Dừng: endpoint không phải production đã biết.'); process.exit(3); }

const journal = JSON.parse(fs.readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')).entries;
const sql = postgres(url, { max: 1, prepare: false });
try {
  await sql.begin('read only', async (tx) => {
    // Khớp theo dấu thời gian (created_at = journal.when), KHÔNG theo thứ tự: production từng áp 0015/0016 mà bỏ 0014.
    // Lưu ý drizzle-kit migrate chỉ áp migration MỚI HƠN cái cuối đã áp → migration bị bỏ giữa chừng sẽ không bao giờ tự áp.
    const rows = await tx`select created_at from drizzle.__drizzle_migrations`;
    const applied = new Set(rows.map(r => Number(r.created_at)));
    const last = Math.max(0, ...applied);
    const missing = journal.filter(e => !applied.has(e.when));
    const skipped = missing.filter(e => e.when < last), pending = missing.filter(e => e.when > last);
    console.log(`Đã áp ${rows.length}/${journal.length} migration${missing.length ? '' : ' (đủ)'}`);
    if (pending.length) console.log('Còn treo (db:migrate sẽ áp):', pending.map(e => e.tag).join(', '));
    if (skipped.length) console.log('BỊ BỎ QUA (cũ hơn migration cuối → db:migrate KHÔNG tự áp, phải xử lý tay):', skipped.map(e => e.tag).join(', '));
    const reg = async (name) => (await tx`select to_regclass(${'public.' + name}) is not null as ok`)[0].ok;
    const col = async (t, c) => (await tx`select count(*)::int as n from information_schema.columns where table_schema='public' and table_name=${t} and column_name=${c}`)[0].n > 0;
    console.log('Dấu hiệu:', JSON.stringify({
      '0014 (bảng learn_* đã xoá)': !(await reg('learn_lessons')) && !(await reg('learn_course_details')),
      '0015 (study_courses.deleted_at)': await col('study_courses', 'deleted_at'),
      '0016 (documents.study_course_id)': await col('documents', 'study_course_id'),
      '0017 (sleep_logs)': await reg('sleep_logs'),
    }));
    if (await reg('learn_lessons')) {
      const [l] = await tx`select (select count(*)::int from learn_lessons) as lessons, (select count(*)::int from learn_course_details) as details,
                                 (select count(*)::int from projects where type::text = 'LEARN') as projects`;
      console.log('Học tập cũ còn dữ liệu (0014 sẽ TỰ DỪNG nếu khác 0):', JSON.stringify(l));
    }
    const [t] = await tx`select count(*)::int as n from information_schema.tables where table_schema='public'`;
    const wallets = await tx`select name, current_balance from finance_accounts where archived_at is null order by name`;
    console.log(`Bảng public: ${t.n} · Số dư ví: ${wallets.map(w => `${w.name} ${w.current_balance}`).join(' · ') || '(không có)'}`);
  });
} finally { await sql.end(); }

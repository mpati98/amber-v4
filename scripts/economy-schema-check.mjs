// Kiểm migration 0018 (kinh tế) trên DATABASE_URL — CHỈ ĐỌC, không in chuỗi kết nối.
import 'dotenv/config';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Thiếu DATABASE_URL'); process.exit(2); }
console.log(`endpoint ${new URL(url).hostname.split('.')[0]}`);
const sql = postgres(url, { max: 1, prepare: false });
const TABLES = ['economy_events', 'ledger_entries', 'rule_sets', 'check_ins', 'debuffs', 'reward_items', 'redemptions', 'exemption_cards'];
try {
  await sql.begin('read only', async (tx) => {
    const t = await tx`select table_name from information_schema.tables where table_schema = 'public' and table_name in ${tx(TABLES)}`;
    console.log(`bảng mới: ${t.length}/${TABLES.length}`);
    const c = await tx`select 1 from information_schema.columns where table_name = 'tasks' and column_name = 'actual_minutes'`;
    console.log(`tasks.actual_minutes: ${c.length === 1}`);
    const k = await tx`select conname from pg_constraint where conname in ('ledger_entries_event_fk', 'tasks_actual_minutes_check', 'exemption_cards_used_check')`;
    console.log(`ràng buộc: ${k.map((r) => r.conname).sort().join(', ')}`);
    const i = await tx`select indexname from pg_indexes where indexname = 'rule_sets_one_active_key'`;
    console.log(`chỉ mục một bộ luật active: ${i.length === 1}`);
  });
} finally {
  await sql.end();
}

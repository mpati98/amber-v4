// Ảnh chụp số dòng mọi bảng public + số migration — CHỈ ĐỌC (transaction READ ONLY), không in chuỗi kết nối.
// Dùng trước / sau migrate để so: node scripts/with-db.mjs DATABASE_URL_PRODUCTION -- node scripts/db-snapshot.mjs > before.json
import 'dotenv/config';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Thiếu DATABASE_URL'); process.exit(2); }
const sql = postgres(url, { max: 1, prepare: false });
try {
  const out = await sql.begin('read only', async (tx) => {
    const tables = (await tx`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`).map((r) => r.table_name);
    const counts = {};
    for (const t of tables) counts[t] = Number((await tx`select count(*)::int as n from ${tx(t)}`)[0].n);
    const [{ n: migrations }] = await tx`select count(*)::int as n from drizzle.__drizzle_migrations`;
    const wallets = await tx`select name, current_balance::text as balance from finance_accounts order by name`;
    return { migrations, tables: tables.length, counts, wallets: wallets.map((w) => `${w.name}: ${w.balance}`) };
  });
  console.log(JSON.stringify(out, null, 1));
} finally {
  await sql.end();
}

// Chạy một lệnh với DATABASE_URL lấy từ biến khác trong .env (đọc bằng dotenv, KHÔNG qua shell — chuỗi kết nối có `&`
// bị bash cắt hỏng nếu `source .env`). Chỉ in tên endpoint, không bao giờ in chuỗi kết nối.
//
//   node scripts/with-db.mjs DATABASE_URL_TEST_MIGRATE -- node scripts/migration-status.mjs
//   node scripts/with-db.mjs DATABASE_URL_PRODUCTION --expect ep-divine-feather-b3zba6y0 -- npm run db:migrate
//
// --expect <tiền tố endpoint>: dừng (mã 3) nếu endpoint không khớp.
import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const sep = args.indexOf('--');
if (sep < 1 || sep === args.length - 1) {
  console.error('Dùng: node scripts/with-db.mjs <BIẾN_TRONG_.env> [--expect <endpoint>] -- <lệnh> [tham số…]');
  process.exit(2);
}
const head = args.slice(0, sep), cmd = args.slice(sep + 1);
const name = head[0];
const ei = head.indexOf('--expect');
const expect = ei >= 0 ? head[ei + 1] : null;

const parsed = config({ path: '.env', quiet: true }).parsed ?? {};
const url = parsed[name];
if (!url) { console.error(`Thiếu ${name} trong .env`); process.exit(2); }
let endpoint;
try { endpoint = new URL(url).hostname.split('.')[0]; } catch { console.error(`${name} không phải URL hợp lệ`); process.exit(2); }
console.log(`[with-db] ${name} → endpoint ${endpoint}`);
if (expect && !endpoint.startsWith(expect)) { console.error(`[with-db] Dừng: endpoint không khớp ${expect}`); process.exit(3); }

// dotenv trong lệnh con KHÔNG ghi đè biến đã có ⇒ DATABASE_URL này thắng .env.
const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
process.exit(r.status ?? 1);

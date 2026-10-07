// Đánh dấu các migration Drizzle là "đã áp" mà KHÔNG chạy SQL — dùng cho DB đã
// có sẵn bảng trước khi có lịch sử migration (drizzle.__drizzle_migrations rỗng).
//
//   npm run db:baseline -- --through=<tag>
//
// --through bắt buộc, không có mặc định: chỉ đánh dấu tới migration đó (gồm cả nó).
import "dotenv/config";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import postgres from "postgres";

const through = process.argv.find((a) => a.startsWith("--through="))?.slice("--through=".length);
if (!through) {
  console.error("Thiếu --through=<tag>, ví dụ: --through=0003_catchup_existing_tables");
  process.exit(1);
}

const drizzleDir = join(process.cwd(), "drizzle");
const journal = JSON.parse(readFileSync(join(drizzleDir, "meta", "_journal.json"), "utf8")) as {
  entries: { idx: number; tag: string; when: number }[];
};
const last = journal.entries.findIndex((e) => e.tag === through);
if (last === -1) {
  console.error(`Không có migration "${through}" trong _journal.json`);
  process.exit(1);
}
const entries = journal.entries.slice(0, last + 1);

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

async function main() {
  const inserted = await sql.begin(async (tx) => {
    // Cùng định nghĩa bảng mà drizzle-kit migrate tự tạo.
    await tx`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await tx`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`;
    const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
    if (n > 0) {
      console.log(`__drizzle_migrations đã có ${n} dòng — không làm gì.`);
      return null;
    }
    const rows: { tag: string; hash: string; createdAt: number }[] = [];
    for (const e of entries) {
      const hash = createHash("sha256").update(readFileSync(join(drizzleDir, `${e.tag}.sql`), "utf8")).digest("hex");
      await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${e.when})`;
      rows.push({ tag: e.tag, hash, createdAt: e.when });
    }
    return rows;
  });
  if (inserted) {
    console.log(`Đã chèn ${inserted.length} dòng:`);
    for (const r of inserted) console.log(`  ${r.tag}  created_at=${r.createdAt}  hash=${r.hash}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());

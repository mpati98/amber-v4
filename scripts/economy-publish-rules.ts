// Phát hành bộ luật kinh tế cho một user rồi dựng lại sổ cái — cách chỉnh hệ số trong chế độ bóng.
//
//   npx tsx scripts/economy-publish-rules.ts <file.yaml> --user <email> [--note "lý do"] [--dry-run]
//   npx tsx scripts/economy-publish-rules.ts <file.yaml> --user <email> --production --yes-production
//
// 1. Đọc + kiểm kiểu file (sai cú pháp / tên biến / kiểu ⇒ dừng, không ghi gì).
// 2. Trong MỘT transaction (khoá advisory theo user): bộ `active` cũ → `retired`, file thành `active` (version trong file phải lớn hơn
//    mọi version đã có), dựng lại toàn bộ sổ cái, in số dư trước / sau và phạt bóng.
// 3. `--dry-run`: làm hết rồi ROLLBACK — xem trước kết quả của hệ số mới mà không đổi gì.
// Mặc định DATABASE_URL (Neon DEV). Production phải có cả `--production` và `--yes-production`; in endpoint, không in chuỗi kết nối.
import "dotenv/config";
import fs from "node:fs";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const file = args.find((a, i) => !a.startsWith("--") && (i === 0 || !["--user", "--note"].includes(args[i - 1])));
const email = value("--user");
const note = value("--note");
const dryRun = flag("--dry-run");
const production = flag("--production");

if (!file || !email) {
  console.error("Dùng: npx tsx scripts/economy-publish-rules.ts <file.yaml> --user <email> [--note \"...\"] [--dry-run] [--production --yes-production]");
  process.exit(2);
}
if (production) {
  if (!flag("--yes-production")) {
    console.error("Dừng: production cần thêm --yes-production.");
    process.exit(3);
  }
  if (!process.env.DATABASE_URL_PRODUCTION) {
    console.error("Thiếu DATABASE_URL_PRODUCTION.");
    process.exit(2);
  }
  // Phải đặt TRƯỚC khi nạp @/db (db đọc DATABASE_URL lúc import).
  process.env.DATABASE_URL = process.env.DATABASE_URL_PRODUCTION;
}
const endpoint = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname.split(".")[0]; } catch { return ""; } })();
if (!endpoint) { console.error("Thiếu DATABASE_URL."); process.exit(2); }
if (production && !endpoint.startsWith("ep-divine-feather-b3zba6y0")) {
  console.error(`Dừng: endpoint ${endpoint} không phải production đã biết.`);
  process.exit(3);
}

async function main() {
  const yaml = fs.readFileSync(file!, "utf8");
  const { loadRuleSet, RuleSetError } = await import("@/lib/economy-rules");
  let version: number;
  try {
    const rs = loadRuleSet(yaml);
    version = rs.version;
    console.log(`Luật hợp lệ: version ${rs.version}, ${rs.rules.length} luật, phạt ${rs.penalties_live_from ? `trừ thật từ ${rs.penalties_live_from}` : "chế độ bóng"}`);
  } catch (err) {
    if (err instanceof RuleSetError) { console.error(`Luật không hợp lệ: ${err.message}`); process.exit(1); }
    throw err;
  }

  const { and, eq } = await import("drizzle-orm");
  const { db } = await import("@/db");
  const { ruleSets, users } = await import("@/db/schema");
  const { publishRuleSet, summaryInTx, PublishError } = await import("@/lib/economy-db");
  console.log(`DB: ${production ? "PRODUCTION" : "DATABASE_URL"} · endpoint ${endpoint}${dryRun ? " · DRY RUN (rollback)" : ""}`);

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email!)).limit(1);
  if (!user) { console.error("Không tìm thấy user với email đó."); process.exit(1); }

  const ROLLBACK = Symbol("rollback");
  try {
    await db.transaction(async (tx) => {
      const [active] = await tx.select({ version: ruleSets.version }).from(ruleSets).where(and(eq(ruleSets.userId, user.id), eq(ruleSets.status, "active"))).limit(1);
      const before = active ? await summaryInTx(tx, user.id, { limit: 1 }) : null;
      const { previousVersion, sync } = await publishRuleSet(tx, user.id, yaml, { note });
      const after = await summaryInTx(tx, user.id, { limit: 1 });
      const fmt = (s: typeof after | null) =>
        s ? `số dư ${s.balance} · nếu bật phạt ${s.shadow.balanceIfLive} · phạt bóng ${s.shadow.hiddenPenalties.count} (${s.shadow.hiddenPenalties.total}) · thể lực ${s.stamina.value}/${s.stamina.max} · sức khoẻ ${s.health.value}` : "(chưa có bộ luật)";
      console.log(`Version: ${previousVersion ?? "—"} → ${version}`);
      console.log(`Trước: ${fmt(before)}`);
      console.log(`Sau:   ${fmt(after)}`);
      console.log(`Dựng lại: ${sync.entries} entry từ ${sync.rebuiltFrom}`);
      if (dryRun) throw ROLLBACK;
    });
    console.log("Đã phát hành.");
  } catch (err) {
    if (err === ROLLBACK) { console.log("Dry run: đã rollback, không đổi gì."); return; }
    if (err instanceof PublishError) { console.error(`Không phát hành: ${err.message}`); process.exit(1); }
    throw err;
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

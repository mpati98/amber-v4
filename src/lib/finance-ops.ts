import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { financeAccounts, financeBalanceSnapshots, financeCategories, projects } from "@/db/schema";
import { vnMonthBounds } from "@/lib/vn-time";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DEFAULT_CATEGORIES: { name: string; icon: string; kind: "INCOME" | "EXPENSE" }[] = [
  { name: "Ăn uống", icon: "🍜", kind: "EXPENSE" },
  { name: "Tiền trọ", icon: "🏠", kind: "EXPENSE" },
  { name: "Xăng / đi lại", icon: "🛵", kind: "EXPENSE" },
  { name: "Mua sắm", icon: "🛍️", kind: "EXPENSE" },
  { name: "Khác", icon: "🗂", kind: "EXPENSE" },
  { name: "Lương", icon: "💰", kind: "INCOME" },
  { name: "Thu nhập khác", icon: "💵", kind: "INCOME" },
];

/**
 * Tạo (nếu chưa có) dự án FINANCE của tháng hiện tại theo giờ VN. Idempotent. Đồng thời lưu trữ
 * mọi tháng cũ đã qua endDate, seed danh mục mặc định lần đầu và chụp số dư đầu tháng.
 */
export async function ensureCurrentFinanceMonth(userId: string, now: Date = new Date()) {
  // Tháng theo giờ VN: theo UTC, 0h–7h sáng ngày 1 vẫn tính là tháng trước →
  // không tạo được tháng mới và chưa lưu trữ tháng cũ.
  const { year, month, start, end } = vnMonthBounds(now);

  return db.transaction(async (tx) => {
    // Archive mọi project FINANCE đã qua endDate mà chưa archive
    await tx
      .update(projects)
      .set({ archivedAt: now })
      .where(and(eq(projects.userId, userId), eq(projects.type, "FINANCE"), isNull(projects.archivedAt), lt(projects.endDate, start)));

    const existing = await tx.query.projects.findFirst({
      where: and(eq(projects.userId, userId), eq(projects.type, "FINANCE"), eq(projects.startDate, start)),
    });
    if (existing) return { project: existing, isNew: false };

    // Lần đầu dùng Finance — seed sẵn danh mục mặc định để không phải tự tạo tay
    const categoryCount = await tx.query.financeCategories.findMany({ where: eq(financeCategories.userId, userId) });
    if (categoryCount.length === 0) {
      await tx.insert(financeCategories).values(DEFAULT_CATEGORIES.map((c) => ({ ...c, userId })));
    }

    const [created] = await tx
      .insert(projects)
      .values({
        userId,
        name: `Tài chính — Tháng ${month}/${year}`,
        type: "FINANCE",
        startDate: start,
        endDate: end,
      })
      .returning();

    // Chụp số dư mọi ví tại thời điểm bắt đầu tháng — làm điểm dữ liệu cho biểu đồ biến động
    const accounts = await tx.query.financeAccounts.findMany({
      where: and(eq(financeAccounts.userId, userId), isNull(financeAccounts.archivedAt)),
    });
    const totalBalance = accounts.reduce((sum, a) => sum + Number(a.currentBalance), 0);
    await tx.insert(financeBalanceSnapshots).values({ projectId: created.id, totalBalance: String(totalBalance) });

    return { project: created, isNew: true };
  });
}

/**
 * Cộng/trừ số dư ví theo một giao dịch. INCOME cộng, EXPENSE trừ; [reverse] đảo ngược tác động
 * (dùng khi xoá hoặc sửa giao dịch). Chỉ đụng finance_accounts.current_balance, không đụng snapshot.
 */
export async function applyBalance(
  tx: Tx,
  t: { accountId: string; kind: string; amount: number },
  opts: { reverse?: boolean } = {}
): Promise<void> {
  const sign = (t.kind === "INCOME" ? 1 : -1) * (opts.reverse ? -1 : 1);
  const delta = sign * t.amount;
  await tx
    .update(financeAccounts)
    .set({ currentBalance: sql`${financeAccounts.currentBalance} + ${delta}` })
    .where(eq(financeAccounts.id, t.accountId));
}

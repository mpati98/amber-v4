import { NextResponse } from "next/server";
import { withAuth } from "@/lib/withAuth";
import { db } from "@/db";
import { projects, tasks, financeTransactions, financeBudgets } from "@/db/schema";
import { eq, and, ne, isNotNull, sql } from "drizzle-orm";
import { formatVND } from "@/lib/currency";
import { vnMonthBounds, vnToday } from "@/lib/vn-time";
import { isDeadlineAlert } from "@/lib/deadline-alert";

type Alert = {
  id: string;
  kind: "TASK_DUE" | "BUDGET_EXCEEDED" | "FINANCE_MONTH_MISSING";
  title: string;
  detail?: string;
  href: string;
};

export const GET = withAuth(async (_req, userId) => {
  const now = new Date();
  const alerts: Alert[] = [];

  // Mốc ngày/tháng theo lịch VN — server chạy UTC, 0h–7h sáng VN vẫn là "hôm qua".
  const today = vnToday(now);

  // 1) Việc bật thông báo hạn: dueDate ≤ hôm nay + prepLeadDays (mặc định 3), chưa DONE.
  // Quá hạn vẫn hiện tới khi DONE. SQL lọc thô, điều kiện chính nằm ở isDeadlineAlert.
  const dueTasks = await db.query.tasks.findMany({
    where: and(eq(tasks.userId, userId), eq(tasks.notifyDeadline, true), ne(tasks.status, "DONE"), isNotNull(tasks.dueDate)),
  });
  for (const t of dueTasks.filter((t) => isDeadlineAlert(t, today))) {
    alerts.push({
      id: `task:${t.id}`,
      kind: "TASK_DUE",
      title: `Sắp/đã trễ hạn: "${t.title}"`,
      detail: t.dueDate ?? undefined,
      href: "/du-an",
    });
  }

  // 2) & 3) Project FINANCE tháng hiện tại — vượt ngân sách hoặc chưa bắt đầu tháng mới
  // Khớp đúng startDate mà POST /finance/projects tạo ra (cũng theo lịch VN).
  const { start } = vnMonthBounds(now);
  const currentFinance = await db.query.projects.findFirst({
    where: and(eq(projects.userId, userId), eq(projects.type, "FINANCE"), eq(projects.startDate, start)),
  });

  if (!currentFinance) {
    // Cho 3 ngày đầu tháng (theo lịch VN) rồi mới nhắc.
    if (Number(today.slice(8, 10)) > 3) {
      alerts.push({
        id: "finance:missing-month",
        kind: "FINANCE_MONTH_MISSING",
        title: "Chưa bắt đầu dự án tài chính cho tháng này",
        href: "/finance",
      });
    }
  } else {
    const budgets = await db.query.financeBudgets.findMany({
      where: eq(financeBudgets.projectId, currentFinance.id),
      with: { category: true },
    });
    if (budgets.length > 0) {
      const spentRows = await db
        .select({
          categoryId: financeTransactions.categoryId,
          total: sql<string>`coalesce(sum(${financeTransactions.amount}), 0)`,
        })
        .from(financeTransactions)
        .where(and(eq(financeTransactions.projectId, currentFinance.id), eq(financeTransactions.kind, "EXPENSE")))
        .groupBy(financeTransactions.categoryId);
      const spentByCategory = new Map(spentRows.map((r) => [r.categoryId, Number(r.total)]));

      for (const b of budgets) {
        const spent = spentByCategory.get(b.categoryId) ?? 0;
        const limit = Number(b.limitAmount);
        if (spent > limit) {
          alerts.push({
            id: `budget:${b.id}`,
            kind: "BUDGET_EXCEEDED",
            title: `Vượt ngân sách "${b.category?.name ?? "?"}"`,
            detail: `${formatVND(spent)} / ${formatVND(limit)}`,
            href: `/finance/${currentFinance.id}`,
          });
        }
      }
    }
  }

  const recentActivity = await db.query.activityLogs.findMany({
    where: (a, { eq: eqOp }) => eqOp(a.userId, userId),
    orderBy: (a, { desc }) => desc(a.createdAt),
    limit: 20,
  });

  return NextResponse.json({ alerts, recentActivity });
});

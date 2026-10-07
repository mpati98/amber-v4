import { NextResponse } from "next/server";
import { withAuth } from "@/lib/withAuth";
import { db } from "@/db";
import { financeAccounts, financeCategories, financeTransactions, projects } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "@/lib/activity-log";
import { applyBalance, ensureCurrentFinanceMonth } from "@/lib/finance-ops";
import { findMonthForDate, isInCurrentVnMonth, vnDateOf } from "@/lib/finance-month";
import { isOwnedStandardProject } from "@/lib/linked-project";

const createTransactionSchema = z
  .object({
    // Tháng tài chính (project FINANCE). Có thể bỏ khi có linkedProjectId — server tự tìm theo occurredAt.
    projectId: z.string().uuid().optional(),
    // Dự án STANDARD mà giao dịch được gắn vào để xem thu-chi theo dự án.
    linkedProjectId: z.string().uuid().optional(),
    accountId: z.string().uuid(),
    categoryId: z.string().uuid().optional(),
    kind: z.enum(["INCOME", "EXPENSE"]),
    amount: z.number().positive(),
    note: z.string().optional(),
    occurredAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: "invalid date" }).optional(),
  })
  .refine((d) => d.projectId || d.linkedProjectId, { message: "Required", path: ["projectId"] });

export const GET = withAuth(async (req, userId) => {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const linkedProjectId = req.nextUrl.searchParams.get("linkedProjectId");

  // ?projectId= (giao dịch của một tháng) giữ nguyên; ?linkedProjectId= lấy mọi giao dịch
  // gắn với một dự án STANDARD, qua mọi tháng. Có cả hai thì projectId được ưu tiên.
  if (!projectId && linkedProjectId) {
    if (!(await isOwnedStandardProject(linkedProjectId, userId))) {
      return NextResponse.json({ error: "project_not_found" }, { status: 404 });
    }
    const rows = await db.query.financeTransactions.findMany({
      where: (t, { eq: eqOp, and: andOp }) => andOp(eqOp(t.userId, userId), eqOp(t.linkedProjectId, linkedProjectId)),
      with: { category: true, account: true },
      orderBy: (t, { desc }) => desc(t.occurredAt),
    });
    return NextResponse.json(rows);
  }

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const rows = await db.query.financeTransactions.findMany({
    where: (t, { eq: eqOp, and: andOp }) => andOp(eqOp(t.userId, userId), eqOp(t.projectId, projectId)),
    with: { category: true, account: true },
    orderBy: (t, { desc }) => desc(t.occurredAt),
  });
  return NextResponse.json(rows);
});

export const POST = withAuth(async (req, userId) => {
  const body = await req.json();
  const parsed = createTransactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { accountId, projectId: givenProjectId, linkedProjectId, kind, amount, occurredAt, ...rest } = parsed.data;

  if (linkedProjectId && !(await isOwnedStandardProject(linkedProjectId, userId))) {
    return NextResponse.json({ error: "linked_project_invalid" }, { status: 400 });
  }

  const when = occurredAt ? new Date(occurredAt) : new Date();

  // Tháng tài chính phải là project FINANCE của chính user và còn mở. Trước đây
  // không kiểm tra gì: ghi được giao dịch vào project bất kỳ (của người khác,
  // project thường, học tập) hoặc vào tháng đã kết thúc.
  // Không tồn tại / của người khác / không phải FINANCE → cùng 1 mã 404.
  let project;
  if (givenProjectId) {
    project = await db.query.projects.findFirst({
      where: and(eq(projects.id, givenProjectId), eq(projects.userId, userId), eq(projects.type, "FINANCE")),
    });
    if (!project) {
      return NextResponse.json({ error: "project_not_found" }, { status: 404 });
    }
  } else {
    // Không gửi projectId (chỉ có linkedProjectId): tìm tháng chứa occurredAt theo giờ VN;
    // chưa có mà đó là tháng hiện tại thì tạo bằng đúng logic của POST /api/finance/projects.
    const months = await db.query.projects.findMany({
      where: and(eq(projects.userId, userId), eq(projects.type, "FINANCE")),
    });
    project = findMonthForDate(months, vnDateOf(when)) ?? undefined;
    if (!project) {
      if (!isInCurrentVnMonth(when)) {
        return NextResponse.json({ error: "finance_month_not_found" }, { status: 400 });
      }
      project = (await ensureCurrentFinanceMonth(userId)).project;
    }
  }
  if (project.archivedAt) {
    return NextResponse.json({ error: "project_archived" }, { status: 400 });
  }

  // Trước đây throw → 500; giờ trả 404 rõ ràng.
  const account = await db.query.financeAccounts.findFirst({
    where: and(eq(financeAccounts.id, accountId), eq(financeAccounts.userId, userId)),
  });
  if (!account) {
    return NextResponse.json({ error: "account_not_found" }, { status: 404 });
  }

  // Danh mục (nếu có) cũng phải của user — trước đây gắn được danh mục của
  // người khác, và GET giao dịch sẽ join ra tên/icon danh mục đó.
  if (rest.categoryId) {
    const category = await db.query.financeCategories.findFirst({
      where: and(eq(financeCategories.id, rest.categoryId), eq(financeCategories.userId, userId)),
    });
    if (!category) {
      return NextResponse.json({ error: "category_not_found" }, { status: 404 });
    }
  }

  const result = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(financeTransactions)
      .values({
        ...rest,
        accountId,
        projectId: project.id,
        linkedProjectId: linkedProjectId ?? null,
        kind,
        amount: String(amount),
        occurredAt: when,
        userId,
      })
      .returning();

    await applyBalance(tx, { accountId, kind, amount });

    return created;
  });

  await logActivity({
    userId,
    source: "FINANCE",
    action: "finance.transaction_created",
    title: result.note || (result.kind === "INCOME" ? "Thu nhập" : "Chi tiêu"),
    metadata: { amount: result.amount, kind: result.kind },
  });

  return NextResponse.json(result, { status: 201 });
});

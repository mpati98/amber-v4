import { NextResponse } from "next/server";
import { withAuth } from "@/lib/withAuth";
import { db } from "@/db";
import { financeAccounts, financeCategories, financeTransactions } from "@/db/schema";
import { logActivity } from "@/lib/activity-log";
import { applyBalance } from "@/lib/finance-ops";
import { isOwnedStandardProject } from "@/lib/linked-project";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

// .strict(): gửi occurredAt hoặc projectId (hay trường lạ) → 400, hai trường này không sửa được.
const patchTransactionSchema = z
  .object({
    note: z.string().nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    linkedProjectId: z.string().uuid().nullable().optional(),
    accountId: z.string().uuid().optional(),
    kind: z.enum(["INCOME", "EXPENSE"]).optional(),
    amount: z.number().positive().optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const existing = z.string().uuid().safeParse(id).success
    ? await db.query.financeTransactions.findFirst({
        where: and(eq(financeTransactions.id, id), eq(financeTransactions.userId, userId)),
      })
    : undefined;
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = patchTransactionSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "empty patch" }, { status: 400 });
  }

  if (data.linkedProjectId && !(await isOwnedStandardProject(data.linkedProjectId, userId))) {
    return NextResponse.json({ error: "linked_project_invalid" }, { status: 400 });
  }
  if (data.categoryId) {
    const category = await db.query.financeCategories.findFirst({
      where: and(eq(financeCategories.id, data.categoryId), eq(financeCategories.userId, userId)),
    });
    if (!category) return NextResponse.json({ error: "category_not_found" }, { status: 404 });
  }
  if (data.accountId) {
    const account = await db.query.financeAccounts.findFirst({
      where: and(eq(financeAccounts.id, data.accountId), eq(financeAccounts.userId, userId)),
    });
    if (!account) return NextResponse.json({ error: "account_not_found" }, { status: 404 });
  }

  const next = {
    accountId: data.accountId ?? existing.accountId,
    kind: data.kind ?? existing.kind,
    amount: data.amount ?? Number(existing.amount),
  };
  const balanceChanged =
    next.accountId !== existing.accountId || next.kind !== existing.kind || next.amount !== Number(existing.amount);

  // Đổi amount/kind/accountId: đảo tác động của bản ghi cũ lên ví cũ rồi áp bản ghi mới lên ví mới,
  // cùng 1 transaction với việc ghi giao dịch — số dư ví không bao giờ lệch nửa chừng.
  await db.transaction(async (tx) => {
    if (balanceChanged) {
      await applyBalance(tx, { accountId: existing.accountId, kind: existing.kind, amount: Number(existing.amount) }, { reverse: true });
      await applyBalance(tx, next);
    }
    await tx
      .update(financeTransactions)
      .set({
        ...(data.note !== undefined ? { note: data.note } : {}),
        ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
        ...(data.linkedProjectId !== undefined ? { linkedProjectId: data.linkedProjectId } : {}),
        accountId: next.accountId,
        kind: next.kind,
        amount: String(next.amount),
      })
      .where(eq(financeTransactions.id, existing.id));
  });

  const updated = await db.query.financeTransactions.findFirst({
    where: eq(financeTransactions.id, existing.id),
    with: { category: true, account: true },
  });
  return NextResponse.json(updated);
});

export const DELETE = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { id } = await params;

  const found = await db.transaction(async (tx) => {
    const existing = await tx.query.financeTransactions.findFirst({
      where: and(eq(financeTransactions.id, id), eq(financeTransactions.userId, userId)),
    });
    if (!existing) return false;

    // đảo ngược tác động cũ lên số dư ví
    await applyBalance(tx, { accountId: existing.accountId, kind: existing.kind, amount: Number(existing.amount) }, { reverse: true });

    await tx.delete(financeTransactions).where(eq(financeTransactions.id, id));
    return true;
  });
  // Trước đây throw → 500 khi không tìm thấy.
  if (!found) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  logActivity({
    userId,
    source: "FINANCE",
    action: "transaction.deleted",
    title: `Xóa giao dịch: ${id}`,
    metadata: { transactionId: id },
  });

  return NextResponse.json({ success: true });
});

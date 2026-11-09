import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { documentJson } from "@/lib/study-course-note";
import { withAuth } from "@/lib/withAuth";

export const GET = withAuth(async () => {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(documents);
  if (count === 0) return NextResponse.json(null);

  // Ưu tiên tài liệu lâu chưa xem: lấy nửa số bản ghi cũ nhất theo updatedAt, rồi random trong đó
  // (giữ nguyên đúng thuật toán cũ — không phải ORDER BY random() ở DB)
  const poolSize = Math.max(3, Math.ceil(count / 2));
  const pool = await db.query.documents.findMany({
    limit: poolSize,
    orderBy: (d, { asc }) => asc(d.updatedAt),
    with: { topic: true, studyCourse: { columns: { title: true } } },
  });

  const pick = pool[Math.floor(Math.random() * pool.length)];
  return NextResponse.json(documentJson(pick));
});

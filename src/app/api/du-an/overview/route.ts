import { NextResponse } from "next/server";
import { withAuth } from "@/lib/withAuth";
import { vnToday, vnYear } from "@/lib/vn-time";
import { db } from "@/db";

export const GET = withAuth(async (req, userId) => {
  // Theo lịch VN — server chạy UTC, 0h–7h sáng VN vẫn là "hôm qua"/"năm ngoái".
  const year = Number(req.nextUrl.searchParams.get("year") ?? vnYear());
  const today = vnToday();

  const allProjects = await db.query.projects.findMany({
    where: (p, { eq, and }) => and(eq(p.userId, userId), eq(p.type, "STANDARD")),
    with: { tasks: true },
  });

  // STANDARD: cột status quyết định trạng thái (archivedAt không còn dùng).
  const active = allProjects.filter((p) => p.status === "ACTIVE");
  const activeWithProgress = active.map((p) => {
    const total = p.tasks.length;
    const done = p.tasks.filter((t) => t.status === "DONE").length;
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      totalTasks: total,
      doneTasks: done,
      progressPct: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  });

  const completedThisYear = allProjects.filter(
    (p) => p.status === "DONE" && p.closedAt && vnYear(new Date(p.closedAt)) === year
  ).length;

  const upcoming = active
    .filter((p) => p.startDate && p.startDate > today)
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));

  return NextResponse.json({
    year,
    activeProjects: activeWithProgress,
    completedThisYear,
    upcomingProject: upcoming[0] ? { id: upcoming[0].id, name: upcoming[0].name, startDate: upcoming[0].startDate } : null,
    upcomingProjects: upcoming.slice(0, 5).map((p) => ({ id: p.id, name: p.name, startDate: p.startDate, color: p.color })),
  });
});

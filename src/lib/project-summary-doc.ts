import { formatVND } from "@/lib/currency";
import { vnToday } from "@/lib/vn-time";

// Tài liệu tổng kết khi đóng dự án — lưu vào Tàng Kinh Các. Hàm thuần, test ở project-summary-doc.test.ts.

export type SummaryKeyResult = {
  name: string;
  mode: string; // AUTO | MANUAL
  unit: string | null;
  target: number;
  current: number;
  linkedTotal: number;
  linkedDone: number;
  progress: number; // 0..1
};

export type SummaryTask = { title: string; status: string; statusChangedAt: Date | string };

export type ProjectSummaryDocInput = {
  project: { name: string; goal: string | null; startDate: string | null; endDate: string | null };
  keyResults: SummaryKeyResult[];
  tasks: SummaryTask[];
  finance: { income: number; expense: number };
  note: string | null | undefined;
  closedAt: Date;
};

/** "YYYY-MM-DD" → "dd/MM/yyyy"; thiếu hoặc sai dạng → "—". */
export function formatDmy(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

function krLine(kr: SummaryKeyResult): string {
  const unit = kr.unit ? ` ${kr.unit}` : "";
  const value = kr.mode === "AUTO" ? `${kr.linkedDone}/${kr.linkedTotal}` : `${kr.current}/${kr.target}${unit}`;
  return `- ${kr.name}: ${value} (${Math.round(kr.progress * 100)}%)`;
}

/** Việc đã xong theo thứ tự hoàn thành (statusChangedAt tăng dần); bằng nhau thì theo tên. */
function doneTasksInOrder(tasks: SummaryTask[]): SummaryTask[] {
  return tasks
    .filter((t) => t.status === "DONE")
    .sort((a, b) => new Date(a.statusChangedAt).getTime() - new Date(b.statusChangedAt).getTime() || a.title.localeCompare(b.title, "vi"));
}

export function buildProjectSummaryDoc(input: ProjectSummaryDocInput): { title: string; content: string } {
  const closedDay = formatDmy(vnToday(input.closedAt));
  const { project } = input;
  const goal = project.goal?.trim();
  const note = input.note?.trim();
  const done = doneTasksInOrder(input.tasks);
  const notDone = input.tasks.length - done.length;
  const net = input.finance.income - input.finance.expense;

  const lines: string[] = [
    `Dự án: ${project.name}`,
    `Mục tiêu: ${goal ? goal : "—"}`,
    `Thời gian: ${formatDmy(project.startDate)} – ${formatDmy(project.endDate)} · Đóng ngày ${closedDay}`,
    "",
    "Kết quả then chốt",
    ...(input.keyResults.length === 0 ? ["Không có KR."] : input.keyResults.map(krLine)),
    "",
    `Việc đã xong (${done.length}/${input.tasks.length})`,
    ...(done.length === 0 ? ["Chưa có việc nào xong."] : done.map((t) => `- ${t.title}`)),
    ...(notDone > 0 ? [`Còn ${notDone} việc chưa xong.`] : []),
    "",
    `Thu-chi: Thu ${formatVND(input.finance.income)} · Chi ${formatVND(input.finance.expense)} · Ròng ${formatVND(net)}`,
    "",
    "Ghi chú tổng kết",
    note ? note : "—",
  ];

  return { title: `Tổng kết dự án: ${project.name} — ${closedDay}`, content: lines.join("\n") };
}

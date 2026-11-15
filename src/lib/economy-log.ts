// Nhật ký "luật nào áp vào sự kiện nào" cho màn chủ 3D — hàm thuần. Một dòng = một (sự kiện, luật), gộp Nguyên Tệ + Thể lực.
// Phạt ở chế độ bóng không bao giờ đi vào đây (bên gọi đã lọc).

export const RULE_LABEL: Record<string, string> = {
  task_on_time: "Xong việc đúng hạn",
  task_late: "Xong việc trễ hạn",
  task_late_waived: "Xong việc trễ hạn (được miễn phạt)",
  study: "Học",
  exercise_stamina: "Tập luyện",
  redeem: "Đổi thưởng",
  buy_card: "Mua thẻ miễn phạt",
};

export type LogEntryIn = { eventId: string; ruleId: string; key: string; amount: number; occurredAt: string };
export type LogLine = { eventId: string; ruleId: string; text: string; nguyenTe: number; stamina: number; at: string };

const round2 = (x: number) => Math.round(x * 100) / 100;

/** `entries` mới trước; giữ thứ tự đó. `titles` theo eventId (tên việc, môn học, routine) — thiếu thì chỉ ghi tên luật. */
export function buildLogLines(entries: LogEntryIn[], titles: ReadonlyMap<string, string>, limit = 20): LogLine[] {
  const out: LogLine[] = [];
  const byKey = new Map<string, LogLine>();
  for (const x of entries) {
    const k = `${x.eventId}\u0000${x.ruleId}`;
    let line = byKey.get(k);
    if (!line) {
      if (out.length >= limit) continue;
      const title = titles.get(x.eventId);
      line = { eventId: x.eventId, ruleId: x.ruleId, text: `${RULE_LABEL[x.ruleId] ?? x.ruleId}${title ? `: ${title}` : ""}`, nguyenTe: 0, stamina: 0, at: x.occurredAt };
      byKey.set(k, line);
      out.push(line);
    }
    if (x.key === "nguyen_te") line.nguyenTe = round2(line.nguyenTe + x.amount);
    else if (x.key === "stamina") line.stamina = round2(line.stamina + x.amount);
  }
  return out;
}

/** Tách eventId có tiền tố nguồn → (nguồn, id gốc) để tra tên. */
export function parseEventRef(eventId: string): { kind: "task" | "study" | "routine" | null; id: string | null } {
  const m = /^(amber-task|amber-task-occ|study-log|routine-log):([0-9a-f-]{36})/.exec(eventId);
  if (!m) return { kind: null, id: null };
  return { kind: m[1].startsWith("amber-task") ? "task" : m[1] === "study-log" ? "study" : "routine", id: m[2] };
}

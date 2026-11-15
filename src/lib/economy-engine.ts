// Bộ thi hành luật kinh tế — hàm thuần, xác định. Sổ cái là BẢN CHIẾU dựng lại từ sự kiện:
// cùng sự kiện + cùng luật + cùng ngữ cảnh ⇒ cùng sổ cái. Sự kiện về muộn ⇒ dựng lại từ ngày của nó trở đi.
//
// Thứ tự mỗi entry Nguyên Tệ: kết quả luật → × manual_weight (nếu manual; chỉ Nguyên Tệ) → trần kiếm trong ngày
// (chỉ phần dương) → sàn nợ (phần phạt vượt sàn bị xoá). Phạt trước `penalties_live_from` (hoặc mọi phạt khi null)
// chạy ở chế độ bóng: ghi lại nhưng không trừ. Thể lực: bắt đầu ngày = thể lực buổi sáng, cộng dần theo thứ tự thời gian,
// kẹp trong [0, stamina_max] sau mỗi entry. Biến trong biểu thức là trạng thái TRƯỚC sự kiện.

import { vnToday } from "@/lib/vn-time";
import type { EconomyContext } from "@/lib/economy-health";
import { SPEND_EVENT_TYPES, type LedgerKey, type RuleSet } from "@/lib/economy-rules";

export type EventSource = "auto" | "manual";

export type EconomyEvent = {
  /** Khoá duy nhất, có tiền tố nguồn: "amber-task:<id>:done", "study-log:<id>"… */
  eventId: string;
  type: string;
  source: EventSource;
  occurredAt: Date;
  data: Record<string, unknown>;
};

export type LedgerEntry = {
  eventId: string;
  ruleId: string;
  rulesVersion: number;
  key: LedgerKey;
  /** Kết quả luật (sau hệ số manual), trước trần/sàn/kẹp — để nhật ký giải thích được vì sao bị cắt. */
  rawAmount: number;
  /** Phần thật sự áp vào số dư. Số dư = tổng `amount`. */
  amount: number;
  /** Phạt bị giữ lại ở chế độ bóng (amount = 0, rawAmount = mức phạt lẽ ra). UI chưa hiện các entry này. */
  shadow: boolean;
  source: EventSource;
  occurredAt: Date;
  vnDate: string;
};

export type ReplayResult = {
  entries: LedgerEntry[];
  balance: number;
  /** Thể lực cuối cùng của từng ngày có sự kiện. */
  staminaByDay: Map<string, number>;
};

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Thứ tự xử lý: thời điểm, rồi eventId (để hai sự kiện cùng mili giây vẫn xác định). */
export function compareEvents(a: EconomyEvent, b: EconomyEvent): number {
  const t = a.occurredAt.getTime() - b.occurredAt.getTime();
  return t !== 0 ? t : a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

/** Gộp sự kiện gửi lại: cùng eventId ⇒ bản mới thay bản cũ (không bao giờ thành hai sự kiện). */
export function mergeEvents(existing: EconomyEvent[], incoming: EconomyEvent[]): EconomyEvent[] {
  const map = new Map(existing.map((e) => [e.eventId, e]));
  for (const e of incoming) map.set(e.eventId, e);
  return [...map.values()];
}

/**
 * Dựng sổ cái cho `events` (mọi sự kiện từ ngày bắt đầu dựng trở đi). `openingBalance` = tổng `amount` Nguyên Tệ
 * của các entry trước ngày đó (dựng lại từ đầu thì 0).
 */
export function replay(
  events: EconomyEvent[],
  rules: RuleSet,
  ctx: EconomyContext,
  openingBalance = 0,
  opts: { /** Bỏ chế độ bóng: phạt áp hết — để tính "số dư nếu phạt đã bật" khi chỉnh hệ số. */ allPenaltiesLive?: boolean } = {},
): ReplayResult {
  const liveFrom = rules.penalties_live_from;
  const penaltyLive = (vnDate: string) => opts.allPenaltiesLive === true || (liveFrom != null && vnDate >= liveFrom);
  const ids = new Set<string>();
  for (const e of events) {
    if (ids.has(e.eventId)) throw new Error(`Sự kiện trùng eventId: ${e.eventId}`);
    ids.add(e.eventId);
  }
  const { nguyen_te_per_day: cap, manual_weight: manualWeight, debt_floor: floor } = rules.caps;
  const sorted = [...events].sort(compareEvents);
  const entries: LedgerEntry[] = [];
  const staminaByDay = new Map<string, number>();
  let balance = openingBalance;
  let day = "";
  let stamina = 0;
  let staminaMax = 0;
  let healthPrev = 0;
  let earnedToday = 0;

  for (const ev of sorted) {
    const vnDate = vnToday(ev.occurredAt);
    if (vnDate !== day) {
      day = vnDate;
      const dc = ctx.day(vnDate);
      stamina = dc.morningStamina;
      staminaMax = dc.staminaMax;
      healthPrev = dc.healthPrev;
      earnedToday = 0;
    }
    const env = {
      vars: { nguyen_te: balance, stamina, health: healthPrev, debuff_active: ctx.debuffActive(ev.occurredAt) },
      e: ev.data,
    };
    // Tính mọi luật khớp trên CÙNG một trạng thái trước sự kiện, rồi mới áp.
    const raw: Array<{ ruleId: string; key: LedgerKey; amount: number }> = [];
    for (const rule of rules.rules) {
      if (rule.event !== ev.type) continue;
      if (rule.when && !rule.when.run(env)) continue;
      for (const d of rule.do) raw.push({ ruleId: rule.id, key: d.key, amount: round2(d.amount.run(env) as number) });
    }
    for (const r of raw) {
      // Trước ngày bắt đầu Nguyên Tệ: không ghi entry Nguyên Tệ nào (số dư bắt đầu từ 0); thể lực vẫn tính để làm nóng.
      if (r.key === "nguyen_te" && rules.nguyen_te_from != null && vnDate < rules.nguyen_te_from) continue;
      // Hệ số manual chỉ giảm Nguyên Tệ tự khai; thể lực vẫn hao đủ (một giờ học tự ghi vẫn là một giờ học).
      const weighted = ev.source === "manual" && r.key === "nguyen_te" ? round2(r.amount * manualWeight) : r.amount;
      let applied: number;
      let shadow = false;
      if (r.key === "nguyen_te" && weighted < 0 && !SPEND_EVENT_TYPES.has(ev.type) && !penaltyLive(vnDate)) {
        // Chế độ bóng: phạt được tính và ghi lại (raw_amount) nhưng không trừ vào số dư.
        applied = 0;
        shadow = true;
      } else if (r.key === "nguyen_te") {
        let amt = weighted;
        if (amt > 0) {
          amt = Math.min(amt, Math.max(cap - earnedToday, 0));
          earnedToday = round2(earnedToday + amt);
        }
        const next = Math.max(round2(balance + amt), floor);
        applied = round2(next - balance);
        balance = next;
      } else {
        const next = Math.min(staminaMax, Math.max(0, round2(stamina + weighted)));
        applied = round2(next - stamina);
        stamina = next;
      }
      entries.push({
        eventId: ev.eventId,
        ruleId: r.ruleId,
        rulesVersion: rules.version,
        key: r.key,
        rawAmount: weighted,
        amount: applied,
        shadow,
        source: ev.source,
        occurredAt: ev.occurredAt,
        vnDate,
      });
    }
    staminaByDay.set(vnDate, stamina);
  }
  return { entries, balance: round2(balance), staminaByDay };
}

/** Số dư Nguyên Tệ từ sổ cái (tổng phần đã áp). */
export function ledgerBalance(entries: Array<{ key: string; amount: number }>): number {
  return round2(entries.reduce((s, x) => (x.key === "nguyen_te" ? s + x.amount : s), 0));
}

/** Thể lực hiện tại của một ngày = thể lực buổi sáng + entry thể lực trong ngày (đã kẹp lúc dựng). */
export function staminaOn(date: string, entries: Array<{ key: string; amount: number; vnDate: string }>, ctx: EconomyContext): number {
  const dc = ctx.day(date);
  return round2(entries.reduce((s, x) => (x.key === "stamina" && x.vnDate === date ? s + x.amount : s), dc.morningStamina));
}

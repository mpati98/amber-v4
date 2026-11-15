// Test bộ thi hành luật kinh tế + tiêu chí nghiệm thu mục 13 của đặc tả — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ledgerBalance, mergeEvents, replay, staminaOn, type EconomyEvent } from "./economy-engine";
import { loadRuleSet, RuleSetError } from "./economy-rules";
import { buildEconomyContext, buildHealthSeries, sleepScore, type EconomyContext, type HealthDayInput } from "./economy-health";
import { purchaseRefusal } from "./economy-shop";
import { historyStart } from "./economy-sources";
import { addDaysIso } from "./deadline-alert";
import { amberOccurrenceToSource, amberTaskToSource, isOnTime, taskToEvent } from "./economy-tasks";

// Test dùng ngày cố định (tháng 11/2026) ⇒ bỏ ngày bắt đầu Nguyên Tệ của file mặc định; có test riêng cho nó.
const FILE_TEXT = fs.readFileSync(path.join(process.cwd(), "economy/rules.v1.yaml"), "utf8");
const DEFAULT_TEXT = FILE_TEXT.replace(/^nguyen_te_from: .*$/m, "nguyen_te_from: null");
// Phần lớn test kiểm luật phạt ⇒ dùng bản đã bật phạt; chế độ bóng (mặc định) có test riêng.
const RULES_TEXT = DEFAULT_TEXT.replace("penalties_live_from: null", 'penalties_live_from: "2000-01-01"');
const rules = loadRuleSet(RULES_TEXT);

/** Ngữ cảnh cố định: Sức khoẻ hôm trước 80 ⇒ max 92, sáng đầy pin. */
function flatCtx(opts: { healthPrev?: number; morning?: number; debuff?: (at: Date) => boolean } = {}): EconomyContext {
  const healthPrev = opts.healthPrev ?? 80;
  const max = 60 + 0.4 * healthPrev;
  return {
    day: () => ({ healthPrev, staminaMax: max, morningStamina: opts.morning ?? max }),
    debuffActive: opts.debuff ?? (() => false),
  };
}

// 09:00 giờ VN của ngày d, cộng thêm `min` phút.
const at = (d: string, min = 0) => new Date(new Date(`${d}T09:00:00+07:00`).getTime() + min * 60_000);

let seq = 0;
const task = (d: string, o: { onTime?: boolean; est?: number; hours?: number; card?: boolean; min?: number; id?: string } = {}): EconomyEvent => ({
  eventId: o.id ?? `amber-task:t${++seq}:done`,
  type: "task.completed",
  source: "auto",
  occurredAt: at(d, o.min ?? seq),
  data: { on_time: o.onTime ?? true, est_hours: o.est ?? 2, hours: o.hours ?? o.est ?? 2, card_used: o.card ?? false },
});
const study = (d: string, minutes: number, o: { manual?: boolean; min?: number } = {}): EconomyEvent => ({
  eventId: `study-log:s${++seq}`,
  type: "study.logged",
  source: o.manual ? "manual" : "auto",
  occurredAt: at(d, o.min ?? seq),
  data: { minutes },
});
const nt = (r: ReturnType<typeof replay>, eventId: string) =>
  r.entries.filter((x) => x.eventId === eventId && x.key === "nguyen_te").reduce((s, x) => s + x.amount, 0);

test("luật mặc định nạp được và đủ luật", () => {
  assert.equal(rules.version, 1);
  assert.deepEqual(rules.caps, { nguyen_te_per_day: 100, manual_weight: 0.5, debt_floor: -200 });
  assert.deepEqual(
    rules.rules.map((r) => r.id),
    ["task_on_time", "task_late", "task_late_waived", "study", "exercise_stamina", "redeem", "buy_card"],
  );
});

test("task đúng hạn: 4 × giờ ước lượng, +10% khi Sức khoẻ hôm trước ≥ 70; hao thể lực theo giờ thực tế", () => {
  const ev = task("2026-11-10", { est: 2, hours: 3 });
  const r = replay([ev], rules, flatCtx({ healthPrev: 70 }));
  assert.equal(nt(r, ev.eventId), 8.8);
  assert.equal(r.entries.find((x) => x.key === "stamina")!.amount, -18);
  const r2 = replay([ev], rules, flatCtx({ healthPrev: 69.99 }));
  assert.equal(nt(r2, ev.eventId), 8);
  // Giờ ước lượng trần 8 giờ
  const big = task("2026-11-10", { est: 20, hours: 1 });
  assert.equal(nt(replay([big], rules, flatCtx({ healthPrev: 50 })), big.eventId), 32);
});

test("[13] tính lại toàn bộ cho cùng kết quả; dựng lại từ một ngày với số dư mở đầu = dựng từ đầu", () => {
  const evs = [
    task("2026-11-01"), study("2026-11-01", 45), task("2026-11-02", { onTime: false }),
    study("2026-11-03", 90), task("2026-11-03", { est: 5 }), task("2026-11-04", { onTime: false, est: 30 }),
  ];
  const full = replay(evs, rules, flatCtx());
  const again = replay([...evs].reverse(), rules, flatCtx());
  assert.deepEqual(again.entries, full.entries);
  assert.equal(ledgerBalance(full.entries), full.balance);

  const from = "2026-11-03";
  const before = full.entries.filter((x) => x.vnDate < from);
  const partial = replay(evs.filter((e) => e.occurredAt >= new Date(`${from}T00:00:00+07:00`)), rules, flatCtx(), ledgerBalance(before));
  assert.deepEqual([...before, ...partial.entries], full.entries);
  assert.equal(partial.balance, full.balance);
});

test("[13] gửi lại cùng một sự kiện không tạo thêm entry", () => {
  const ev = task("2026-11-05");
  const merged = mergeEvents(mergeEvents([], [ev]), [ev, { ...ev }]);
  assert.equal(merged.length, 1);
  assert.equal(replay(merged, rules, flatCtx()).entries.length, 2);
  // Gửi lại với dữ liệu mới ⇒ bản mới thay bản cũ
  const updated = mergeEvents(merged, [{ ...ev, data: { ...ev.data, est_hours: 4 } }]);
  assert.equal(updated.length, 1);
  assert.equal(nt(replay(updated, rules, flatCtx()), ev.eventId), 17.6);
  // Danh sách có eventId trùng là lỗi lập trình, không âm thầm cộng đôi
  assert.throws(() => replay([ev, ev], rules, flatCtx()), /trùng eventId/);
});

test("[13] số dư không xuống dưới sàn nợ; phạt vượt sàn bị xoá; tiền kiếm được trả nợ trước", () => {
  const lates = Array.from({ length: 15 }, (_, i) => task("2026-11-06", { onTime: false, est: 10, min: i }));
  const r = replay(lates, rules, flatCtx({ morning: 92 }));
  // Thể lực tụt dưới 40 sau vài task ⇒ các task sau được miễn; dùng thể lực cao vô hạn để thử sàn thuần tuý
  const noDrain = loadRuleSet(RULES_TEXT.replace(/-6 \* min\(e\.hours, 8\)/g, "0"));
  const r2 = replay(lates, noDrain, flatCtx());
  assert.equal(r2.balance, -200);
  const applied = r2.entries.filter((x) => x.key === "nguyen_te").map((x) => x.amount);
  assert.deepEqual(applied.slice(0, 10), Array(10).fill(-20));
  assert.ok(applied.slice(10).every((a) => a === 0));
  assert.ok(r2.entries.slice(-2).every((x) => x.key !== "nguyen_te" || x.rawAmount === -20));
  assert.ok(r.balance >= -200);

  // Ngày sau kiếm 8.8 ⇒ số dư -191.2 (trả nợ, không mất phần nào)
  const r3 = replay([...lates, task("2026-11-07", { est: 2 })], noDrain, flatCtx());
  assert.equal(r3.balance, -191.2);
});

test("[13] phần thưởng một ngày không vượt trần; phạt vẫn trừ sau khi chạm trần; ngày mới mở trần lại", () => {
  const evs = [
    ...Array.from({ length: 12 }, (_, i) => study("2026-11-08", 60, { min: i })), // 12 × 10 = 120 > 100
    task("2026-11-08", { onTime: false, est: 3, min: 100 }),
    study("2026-11-09", 60),
  ];
  const r = replay(evs, rules, flatCtx({ morning: 1000 }));
  const earned = (d: string) => r.entries.filter((x) => x.vnDate === d && x.key === "nguyen_te" && x.amount > 0).reduce((s, x) => s + x.amount, 0);
  assert.equal(earned("2026-11-08"), 100);
  assert.equal(r.balance, 100 - 6 + 10);
});

test("[13] trễ hạn khi có debuff / thể lực < 40 / có thẻ: không trừ Nguyên Tệ nhưng vẫn hao Thể lực", () => {
  const cases: Array<[string, EconomyContext, Partial<Parameters<typeof task>[1]>]> = [
    ["debuff", flatCtx({ debuff: () => true }), {}],
    ["hết pin", flatCtx({ morning: 39 }), {}],
    ["thẻ", flatCtx(), { card: true }],
  ];
  for (const [name, ctx, extra] of cases) {
    const ev = task("2026-11-10", { onTime: false, est: 2, hours: 2, ...extra });
    const r = replay([ev], rules, ctx);
    assert.equal(r.entries.filter((x) => x.key === "nguyen_te").length, 0, name);
    assert.deepEqual(r.entries.map((x) => [x.ruleId, x.key]), [["task_late_waived", "stamina"]], name);
    assert.ok(r.entries[0].amount < 0, name);
  }
  // Ngưỡng: đúng 40 vẫn bị phạt
  const ev = task("2026-11-10", { onTime: false, est: 2 });
  assert.equal(nt(replay([ev], rules, flatCtx({ morning: 40 })), ev.eventId), -4);
});

test("[13] entry manual nhân manual_weight (chỉ Nguyên Tệ, thể lực hao đủ), TRƯỚC trần ngày rồi mới tới sàn nợ", () => {
  const ev = study("2026-11-11", 60, { manual: true });
  const r = replay([ev], rules, flatCtx());
  assert.deepEqual(r.entries.map((x) => [x.key, x.rawAmount, x.amount]), [["nguyen_te", 5, 5], ["stamina", -3, -3]]);
  // Phạt từ dữ liệu manual cũng chỉ còn một nửa
  const late = { ...task("2026-11-11", { onTime: false, est: 4 }), source: "manual" as const };
  assert.deepEqual(replay([late], rules, flatCtx()).entries.map((x) => [x.key, x.amount]), [["nguyen_te", -4], ["stamina", -24]]);
  // Đã kiếm 95 trong ngày: manual 10 × 0.5 = 5 vừa khít trần; nếu cắt trần trước rồi mới nhân thì chỉ còn 2.5
  const fill = Array.from({ length: 9 }, (_, i) => study("2026-11-12", 60, { min: i }));
  const top = study("2026-11-12", 30, { min: 20 }); // +5 ⇒ 95
  const manual = study("2026-11-12", 60, { manual: true, min: 30 });
  const r2 = replay([...fill, top, manual], rules, flatCtx({ morning: 1000 }));
  assert.equal(nt(r2, manual.eventId), 5);
  assert.equal(r2.balance, 100);
});

test("[13] task xong rồi mở lại: xoá sự kiện, dựng lại ⇒ số dư về đúng như trước khi hoàn thành", () => {
  const base = [study("2026-11-13", 30), task("2026-11-13", { onTime: false })];
  const before = replay(base, rules, flatCtx()).balance;
  const done = task("2026-11-13", { est: 4 });
  assert.notEqual(replay([...base, done], rules, flatCtx()).balance, before);
  const reopened = [...base, done].filter((e) => e.eventId !== done.eventId);
  assert.equal(replay(reopened, rules, flatCtx()).balance, before);
});

test("[13] đổi luật rồi tính lại lịch sử ra kết quả đúng theo luật mới", () => {
  const evs = [task("2026-11-14", { est: 2 }), study("2026-11-14", 30)];
  const v1 = replay(evs, rules, flatCtx({ healthPrev: 50 }));
  assert.equal(v1.balance, 8 + 5);
  const v2rules = loadRuleSet(RULES_TEXT.replace("version: 1", "version: 2").replace('"4 * min(e.est_hours, 8)', '"5 * min(e.est_hours, 8)'));
  const v2 = replay(evs, v2rules, flatCtx({ healthPrev: 50 }));
  assert.equal(v2.balance, 10 + 5);
  assert.ok(v2.entries.every((x) => x.rulesVersion === 2));
});

test("thể lực: kẹp trong [0, max] sau mỗi entry, biến stamina là giá trị trước sự kiện, sáng hôm sau đặt lại", () => {
  const evs = [
    task("2026-11-15", { est: 8, hours: 8, min: 0 }), // -48: 92 → 44
    task("2026-11-15", { est: 8, hours: 8, min: 1 }), // -48: 44 → 0 (kẹp)
    task("2026-11-15", { onTime: false, est: 2, min: 2 }), // stamina 0 < 40 ⇒ miễn phạt
    task("2026-11-16", { onTime: false, est: 2, min: 0 }), // sáng mới 92 ⇒ bị phạt
  ];
  const ctx = flatCtx({ healthPrev: 80 });
  const r = replay(evs, rules, ctx);
  const s = r.entries.filter((x) => x.key === "stamina").map((x) => x.amount);
  assert.deepEqual(s.slice(0, 3), [-48, -44, 0]);
  assert.equal(r.staminaByDay.get("2026-11-15"), 0);
  assert.equal(staminaOn("2026-11-15", r.entries, ctx), 0);
  assert.equal(nt(r, evs[2].eventId), 0);
  assert.equal(nt(r, evs[3].eventId), -4);
  assert.equal(r.staminaByDay.get("2026-11-16"), 80);
});

test("chi tiêu: đổi thưởng và mua thẻ ghi entry âm", () => {
  const evs: EconomyEvent[] = [
    study("2026-11-17", 60),
    { eventId: "redeem:r1", type: "redeem", source: "auto", occurredAt: at("2026-11-17", 500), data: { price: 7 } },
    { eventId: "buy-card:c1", type: "buy_card", source: "auto", occurredAt: at("2026-11-17", 501), data: { price: 3 } },
  ];
  assert.equal(replay(evs, rules, flatCtx()).balance, 0);
});

test("loadRuleSet báo lỗi rõ ràng", () => {
  const head = "version: 1\nrules:\n";
  assert.throws(() => loadRuleSet("version: [1"), /YAML lỗi/);
  assert.throws(() => loadRuleSet("rules: []"), RuleSetError);
  assert.throws(() => loadRuleSet(`${head}  - { id: a, event: nope, do: [{ key: stamina, amount: 1 }] }`), /sự kiện lạ/);
  assert.throws(() => loadRuleSet(`${head}  - { id: a, event: study.logged, do: [{ key: stamina, amount: 1 }] }\n  - { id: a, event: study.logged, do: [{ key: stamina, amount: 1 }] }`), /Trùng id/);
  assert.throws(() => loadRuleSet(`${head}  - { id: a, event: study.logged, when: "e.minutes", do: [{ key: stamina, amount: 1 }] }`), /Luật a:.*boolean/);
  assert.throws(() => loadRuleSet(`${head}  - { id: a, event: study.logged, do: [{ key: stamina, amount: "e.on_time" }] }`), /không có trường/);
  assert.throws(() => loadRuleSet(`${head}  - { id: a, event: study.logged, do: [{ key: gold, amount: 1 }] }`), /cấu trúc/);
  // Thiếu caps/health/stamina ⇒ dùng mặc định
  const minimal = loadRuleSet(`${head}  - { id: a, event: study.logged, do: [{ key: stamina, amount: 1 }] }`);
  assert.equal(minimal.caps.debt_floor, -200);
  assert.equal(minimal.health.debuff.heavy, 40);
});

test("hạn kiểu ngày so với cuối ngày giờ VN; hạn kiểu thời điểm so UTC", () => {
  const due = { kind: "date" as const, date: "2026-11-15" };
  assert.equal(isOnTime(new Date("2026-11-15T16:59:59.999Z"), due), true); // 23:59:59 VN
  assert.equal(isOnTime(new Date("2026-11-15T17:00:00Z"), due), false); // 00:00 VN ngày 16
  const ts = { kind: "timestamp" as const, at: new Date("2026-11-15T03:00:00Z") };
  assert.equal(isOnTime(new Date("2026-11-15T03:00:00Z"), ts), true);
  assert.equal(isOnTime(new Date("2026-11-15T03:00:01Z"), ts), false);
  assert.equal(isOnTime(new Date(), null), true);
});

test("task amber-v4 → sự kiện: giờ ước lượng = duration/60, giờ thực tế từ actual_minutes, tiền tố nguồn", () => {
  const row = { id: "u1", title: "Viết báo cáo", status: "DONE", dueDate: "2026-11-15", durationMinutes: 90, actualMinutes: 150, statusChangedAt: new Date("2026-11-15T10:00:00Z") };
  const src = amberTaskToSource(row);
  const ev = taskToEvent(src, new Set())!;
  assert.equal(ev.eventId, "amber-task:u1:done");
  assert.deepEqual(ev.data, { on_time: true, est_hours: 1.5, hours: 2.5, card_used: false });
  assert.equal(taskToEvent(amberTaskToSource({ ...row, actualMinutes: null }), new Set(["amber-task:u1"]))!.data.card_used, true);
  assert.equal(taskToEvent(amberTaskToSource({ ...row, actualMinutes: null }), new Set())!.data.hours, 1.5);
  assert.equal(taskToEvent(amberTaskToSource({ ...row, status: "REVIEW" }), new Set()), null);

  const occ = amberOccurrenceToSource({ id: "u2", title: "Đọc", durationMinutes: 30 }, { occurrenceDate: "2026-11-14", completedAt: new Date("2026-11-15T01:00:00Z") });
  const oev = taskToEvent(occ, new Set())!;
  assert.equal(oev.eventId, "amber-task-occ:u2:2026-11-14:done");
  assert.equal(oev.data.on_time, false);
});

test("Sức khoẻ: điểm ngủ, làm mượt, debuff trừ thẳng, thiếu dữ liệu ⇒ trung tính", () => {
  const p = rules.health;
  assert.equal(sleepScore(7, 5, p), 100);
  assert.equal(sleepScore(5.5, 3, p), 0.6 * 75 + 0.4 * 60);
  assert.equal(sleepScore(9, null, p), 75);

  const day = (o: Partial<HealthDayInput>): HealthDayInput => ({ sleepMinutes: null, sleepQuality: null, exerciseMinutes: null, sportMinutes: null, restDay: false, ...o });
  const inputs = new Map([
    ["2026-11-01", day({ sleepMinutes: 420, sleepQuality: 5, exerciseMinutes: 30 })], // điểm 100
    ["2026-11-03", day({ sleepMinutes: 420, sleepQuality: 5, restDay: true })], // 0.5×100 + 0.5×70 = 85
  ]);
  const debuffs = [{ level: "medium" as const, startedAt: new Date("2026-11-03T05:00:00Z"), endedAt: null }];
  const s = buildHealthSeries("2026-11-01", "2026-11-03", inputs, debuffs, p);
  assert.equal(s[0].base, 79); // 0.7×70 + 0.3×100
  assert.equal(s[1].base, 79); // không có dữ liệu ⇒ nền giữ nguyên
  assert.equal(s[2].base, 80.8); // 0.7×79 + 0.3×85
  assert.equal(s[2].health, 55.8); // − debuff vừa 25

  const ctx = buildEconomyContext(s, debuffs, rules);
  const d3 = ctx.day("2026-11-03");
  assert.equal(d3.healthPrev, 79);
  assert.equal(d3.staminaMax, 91.6);
  assert.equal(d3.morningStamina, 91.6); // điểm ngủ 100
  assert.equal(ctx.debuffActive(new Date("2026-11-03T06:00:00Z")), true);
  assert.equal(ctx.debuffActive(new Date("2026-11-03T04:00:00Z")), false);
});

test("chế độ bóng (mặc định): phạt ghi lại nhưng không trừ; thưởng, chi tiêu, thể lực vẫn áp", () => {
  const shadowRules = loadRuleSet(DEFAULT_TEXT);
  assert.equal(shadowRules.penalties_live_from, null);
  const late = task("2026-11-20", { onTime: false, est: 3, hours: 2 });
  const evs: EconomyEvent[] = [
    study("2026-11-20", 60),
    late,
    { eventId: "redeem:r2", type: "redeem", source: "auto", occurredAt: at("2026-11-20", 900), data: { price: 4 } },
  ];
  const r = replay(evs, shadowRules, flatCtx());
  const pen = r.entries.find((x) => x.eventId === late.eventId && x.key === "nguyen_te")!;
  assert.deepEqual([pen.ruleId, pen.rawAmount, pen.amount, pen.shadow], ["task_late", -6, 0, true]);
  assert.equal(r.entries.find((x) => x.eventId === late.eventId && x.key === "stamina")!.amount, -12);
  assert.ok(r.entries.filter((x) => x !== pen).every((x) => !x.shadow));
  assert.equal(r.balance, 10 - 4);
  // "Số dư nếu đã bật phạt" để chỉnh hệ số
  assert.equal(replay(evs, shadowRules, flatCtx(), 0, { allPenaltiesLive: true }).balance, 10 - 6 - 4);

  // Bật phạt từ một ngày: phạt cũ vẫn là bóng, phạt từ ngày đó trừ thật
  const liveFrom = loadRuleSet(DEFAULT_TEXT.replace("penalties_live_from: null", 'penalties_live_from: "2026-11-21"'));
  const late2 = task("2026-11-21", { onTime: false, est: 3 });
  const r2 = replay([late, late2], liveFrom, flatCtx());
  assert.equal(nt(r2, late.eventId), 0);
  assert.equal(nt(r2, late2.eventId), -6);
});

test("cửa hàng: chỉ mua khi số dư ≥ giá", () => {
  assert.equal(purchaseRefusal(10, 10), null);
  assert.equal(purchaseRefusal(9.99, 10), "insufficient_balance");
  assert.equal(purchaseRefusal(-50, 1), "insufficient_balance");
  assert.equal(purchaseRefusal(100, 0), "invalid_price");
  assert.equal(purchaseRefusal(100, -5), "invalid_price");
});

test("ngữ cảnh ngoài chuỗi Sức khoẻ: trước ngày đầu ⇒ nền khởi điểm, sau ngày cuối ⇒ ngày cuối", () => {
  const p = rules.health;
  const s = buildHealthSeries("2026-11-10", "2026-11-11", new Map([["2026-11-10", { sleepMinutes: 180, sleepQuality: 1, exerciseMinutes: 0, sportMinutes: 0, restDay: false }]]), [], p);
  const ctx = buildEconomyContext(s, [], rules);
  assert.equal(ctx.day("2026-11-01").healthPrev, 70);
  assert.equal(ctx.day("2026-11-30").healthPrev, s[1].health);
  assert.ok(s[1].health < 70);
});

test("file mặc định: Nguyên Tệ bắt đầu từ ngày lên production, làm nóng 14 ngày", () => {
  const rs = loadRuleSet(FILE_TEXT);
  assert.match(rs.nguyen_te_from ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(rs.warmup_days, 14);
  assert.equal(rs.penalties_live_from, null, "chế độ bóng vẫn bật");
  assert.equal(historyStart(rs), addDaysIso(rs.nguyen_te_from!, -14));
  assert.equal(historyStart(loadRuleSet(DEFAULT_TEXT)), null);
});

test("nguyen_te_from: sự kiện trước ngày bắt đầu không sinh Nguyên Tệ (số dư 0) nhưng vẫn hao thể lực", () => {
  const start = loadRuleSet(RULES_TEXT.replace("nguyen_te_from: null", 'nguyen_te_from: "2026-11-21"'));
  const before = [study("2026-11-20", 60), task("2026-11-20", { est: 3 }), task("2026-11-20", { onTime: false, est: 5 })];
  const r = replay(before, start, flatCtx());
  assert.equal(r.balance, 0);
  assert.ok(r.entries.every((x) => x.key === "stamina"), "chỉ còn entry thể lực");
  assert.equal(r.entries.length, 3);
  assert.equal(r.staminaByDay.get("2026-11-20"), 92 - 3 - 18 - 30);
  // Từ ngày bắt đầu: thưởng / phạt bình thường, số dư tính từ 0
  const after = [study("2026-11-21", 60), task("2026-11-21", { onTime: false, est: 2 })];
  assert.equal(replay([...before, ...after], start, flatCtx()).balance, 10 - 4);
  // Dựng lại từ đầu vẫn ra số dư 0 cho phần trước ngày bắt đầu
  assert.equal(replay(before, start, flatCtx(), 0).entries.filter((x) => x.key === "nguyen_te").length, 0);
});

test("historyStart: nguyen_te_from − warmup_days; null = toàn bộ lịch sử", () => {
  assert.equal(historyStart({ nguyen_te_from: "2026-11-16", warmup_days: 14 }), "2026-11-02");
  assert.equal(historyStart({ nguyen_te_from: "2026-11-16", warmup_days: 0 }), "2026-11-16");
  assert.equal(historyStart({ nguyen_te_from: null, warmup_days: 14 }), null);
  assert.throws(() => loadRuleSet(DEFAULT_TEXT.replace("warmup_days: 14", "warmup_days: 90")), /warmup_days/);
});

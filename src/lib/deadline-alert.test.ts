// Test điều kiện cảnh báo hạn của Kiều Lâu — chạy: npm test (node:test qua tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysIso, isDeadlineAlert } from "./deadline-alert";

const base = { notifyDeadline: true, status: "PREP", dueDate: "2026-10-10", prepLeadDays: null as number | null };
const TODAY = "2026-10-07";

test("addDaysIso: qua tháng, qua năm, ngày nhuận", () => {
  assert.equal(addDaysIso("2026-10-30", 3), "2026-11-02");
  assert.equal(addDaysIso("2026-12-30", 3), "2027-01-02");
  assert.equal(addDaysIso("2028-02-28", 1), "2028-02-29");
  assert.equal(addDaysIso("2026-10-07", 0), "2026-10-07");
});

test("không bật notifyDeadline thì không cảnh báo", () => {
  assert.equal(isDeadlineAlert({ ...base, notifyDeadline: false, dueDate: "2026-10-01" }, TODAY), false);
});

test("mặc định báo trước 3 ngày: hạn đúng hôm nay+3 thì có, +4 thì không", () => {
  assert.equal(isDeadlineAlert({ ...base, dueDate: "2026-10-10" }, TODAY), true);
  assert.equal(isDeadlineAlert({ ...base, dueDate: "2026-10-11" }, TODAY), false);
});

test("prepLeadDays tuỳ chỉnh", () => {
  assert.equal(isDeadlineAlert({ ...base, dueDate: "2026-10-08", prepLeadDays: 0 }, TODAY), false);
  assert.equal(isDeadlineAlert({ ...base, dueDate: "2026-10-07", prepLeadDays: 0 }, TODAY), true);
  assert.equal(isDeadlineAlert({ ...base, dueDate: "2026-10-14", prepLeadDays: 7 }, TODAY), true);
});

test("quá hạn vẫn cảnh báo cho tới khi DONE", () => {
  assert.equal(isDeadlineAlert({ ...base, dueDate: "2026-09-01" }, TODAY), true);
  assert.equal(isDeadlineAlert({ ...base, dueDate: "2026-09-01", status: "DONE" }, TODAY), false);
});

test("không có dueDate thì không cảnh báo", () => {
  assert.equal(isDeadlineAlert({ ...base, dueDate: null }, TODAY), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { trashCutoff, trashDaysLeft, TRASH_DAYS } from "./study-trash";

const now = new Date("2026-11-09T10:00:00Z");
const ago = (days: number, extraMs = 0) => new Date(now.getTime() - days * 86_400_000 - extraMs);

test("vừa xoá còn 30 ngày; qua 1 ngày nguyên còn 29", () => {
  assert.equal(trashDaysLeft(now, now), TRASH_DAYS);
  assert.equal(trashDaysLeft(ago(0, 3_600_000), now), 30);
  assert.equal(trashDaysLeft(ago(1), now), 29);
});

test("tối thiểu 0, không âm; mốc ở tương lai (lệch đồng hồ) vẫn là 30", () => {
  assert.equal(trashDaysLeft(ago(30), now), 0);
  assert.equal(trashDaysLeft(ago(45), now), 0);
  assert.equal(trashDaysLeft(new Date(now.getTime() + 60_000), now), 30);
});

test("trashCutoff = 30 ngày trước", () => {
  assert.equal(trashCutoff(now).toISOString(), "2026-10-10T10:00:00.000Z");
});

import assert from "node:assert/strict";
import test from "node:test";
import { afterFailure, LOCK_MINUTES, lockRemainingSeconds, lockUntil, MAX_FAILED_PASSWORDS } from "./password-lockout";

const now = new Date("2026-11-09T10:00:00Z");

test("không khoá hoặc đã hết hạn → 0 giây", () => {
  assert.equal(lockRemainingSeconds(null, now), 0);
  assert.equal(lockRemainingSeconds(new Date("2026-11-09T09:59:59Z"), now), 0);
  assert.equal(lockRemainingSeconds(now, now), 0);
});

test("đang khoá → số giây còn lại, làm tròn lên", () => {
  assert.equal(lockRemainingSeconds(new Date("2026-11-09T10:15:00Z"), now), 900);
  assert.equal(lockRemainingSeconds(new Date(now.getTime() + 1500), now), 2);
});

test("lockUntil = now + 15 phút", () => {
  assert.equal(LOCK_MINUTES, 15);
  assert.equal(lockUntil(now).toISOString(), "2026-11-09T10:15:00.000Z");
});

test("sai lần 1..4: tăng bộ đếm, chưa khoá, giữ nguyên mốc khoá cũ", () => {
  let state = { failedCount: 0, lockedUntil: null as Date | null };
  for (let i = 1; i < MAX_FAILED_PASSWORDS; i++) {
    state = afterFailure(state.failedCount, state.lockedUntil, now);
    assert.deepEqual([state.failedCount, state.lockedUntil], [i, null]);
  }
});

test("sai lần thứ 5: khoá 15 phút và bộ đếm về 0", () => {
  const r = afterFailure(MAX_FAILED_PASSWORDS - 1, null, now);
  assert.equal(r.failedCount, 0);
  assert.equal(r.lockedUntil?.toISOString(), "2026-11-09T10:15:00.000Z");
});

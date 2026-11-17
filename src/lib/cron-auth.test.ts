// Test xác thực Vercel Cron — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCronAuth } from "./cron-auth";

test("checkCronAuth", () => {
  assert.equal(checkCronAuth("Bearer s3cret", undefined), "not_configured");
  assert.equal(checkCronAuth("Bearer s3cret", "  "), "not_configured");
  assert.equal(checkCronAuth(null, "s3cret"), "unauthorized");
  assert.equal(checkCronAuth("Bearer sai", "s3cret"), "unauthorized");
  assert.equal(checkCronAuth("s3cret", "s3cret"), "unauthorized", "thiếu tiền tố Bearer");
  assert.equal(checkCronAuth("Bearer s3cret-dai-hon-nhieu", "s3cret"), "unauthorized", "khác độ dài không ném lỗi");
  assert.equal(checkCronAuth("Bearer s3cret", "s3cret"), "ok");
});

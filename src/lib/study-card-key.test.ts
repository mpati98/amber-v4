// Test khoá chuẩn hoá cụm từ — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { phraseKey } from "./study-card-key";

test("cắt đầu cuối, chữ thường", () => {
  assert.equal(phraseKey("  Look Forward To "), "look forward to");
});

test("gộp khoảng trắng, tab và xuống dòng", () => {
  assert.equal(phraseKey("be   about\tto\n+ V"), "be about to + v");
});

test("hai cách viết khác nhau cho cùng một khoá", () => {
  assert.equal(phraseKey("Break  the ICE"), phraseKey(" break the ice"));
});

test("rỗng / chỉ khoảng trắng thành chuỗi rỗng", () => {
  assert.equal(phraseKey("   "), "");
});

// Test hàm thuần của form liên hệ — chạy: npm test (node:test qua tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkRateLimit,
  clientIp,
  hashIp,
  isBot,
  parseContact,
  RATE_LIMITS,
  sanitizeSubjectName,
} from "./contact";

test("sanitizeSubjectName: chặn chèn header CR/LF", () => {
  const out = sanitizeSubjectName("Alice\r\nBcc: x@y.z");
  assert.equal(out, "Alice Bcc: x@y.z");
  assert.doesNotMatch(out, /[\r\n]/);
});

test("sanitizeSubjectName: bỏ ký tự điều khiển, gộp khoảng trắng", () => {
  assert.equal(sanitizeSubjectName("  Bob\u0000\u0007\t\tSmith Jr \u0085 "), "Bob Smith Jr");
});

test("sanitizeSubjectName: cắt tối đa 100 ký tự", () => {
  const out = sanitizeSubjectName("A".repeat(500));
  assert.equal(out.length, 100);
});

test("clientIp: lấy phần tử đầu của x-forwarded-for", () => {
  assert.equal(clientIp("203.0.113.7, 10.0.0.1, 172.16.0.2"), "203.0.113.7");
  assert.equal(clientIp("  2001:db8::1  "), "2001:db8::1");
});

test("clientIp: thiếu header → unknown", () => {
  assert.equal(clientIp(null), "unknown");
  assert.equal(clientIp(undefined), "unknown");
  assert.equal(clientIp(""), "unknown");
  assert.equal(clientIp(" , 10.0.0.1"), "unknown");
});

test("hashIp: ổn định, khác IP thì khác hash, không chứa IP thô", () => {
  const a1 = hashIp("203.0.113.7", "secret");
  assert.equal(a1, hashIp("203.0.113.7", "secret"));
  assert.notEqual(a1, hashIp("203.0.113.8", "secret"));
  assert.notEqual(a1, hashIp("203.0.113.7", "other-secret"));
  assert.match(a1, /^[0-9a-f]{64}$/);
  assert.ok(!a1.includes("203.0.113.7"));
});

const valid = { name: "Alice", email: "alice@example.com", message: "Hello there" };

test("parseContact: hợp lệ (có trim)", () => {
  const r = parseContact({ ...valid, name: "  Alice  ", message: "  Hi  " });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.data.name, "Alice");
    assert.equal(r.data.message, "Hi");
  }
});

test("parseContact: tên rỗng (chỉ khoảng trắng)", () => {
  const r = parseContact({ ...valid, name: "   " });
  assert.deepEqual(r, { ok: false, message: "Please enter your name." });
});

test("parseContact: email sai", () => {
  const r = parseContact({ ...valid, email: "not-an-email" });
  assert.deepEqual(r, { ok: false, message: "Please enter a valid email address." });
});

test("parseContact: message quá dài", () => {
  const r = parseContact({ ...valid, message: "x".repeat(2001) });
  assert.deepEqual(r, { ok: false, message: "Your message is too long (2000 characters max)." });
});

test("parseContact: thiếu trường / sai kiểu → thông điệp chung, không lộ chi tiết", () => {
  assert.deepEqual(parseContact({ name: "A" }), { ok: false, message: "Please fill in your name, email and message." });
  assert.deepEqual(parseContact(null), { ok: false, message: "Please fill in your name, email and message." });
});

test("botcheck: có giá trị thì là bot; false/rỗng/thiếu thì không", () => {
  const r = parseContact({ ...valid, botcheck: "on" });
  assert.ok(r.ok && isBot(r.data.botcheck));
  assert.equal(isBot(true), true);
  assert.equal(isBot("x"), true);
  assert.equal(isBot(false), false);
  assert.equal(isBot(""), false);
  assert.equal(isBot("   "), false);
  assert.equal(isBot(undefined), false);
});

test("checkRateLimit: dưới giới hạn → cho qua", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const r = checkRateLimit(
    {
      ipPerHour: { count: RATE_LIMITS.ipPerHour.limit - 1, oldest: now },
      ipPerDay: { count: 0, oldest: null },
      globalPerDay: { count: 0, oldest: null },
    },
    now,
  );
  assert.deepEqual(r, { limited: false });
});

test("checkRateLimit: vượt giới hạn giờ → Retry-After tới khi tin cũ nhất hết hạn", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const r = checkRateLimit(
    {
      ipPerHour: { count: 3, oldest: new Date("2026-10-04T11:20:00Z") },
      ipPerDay: { count: 3, oldest: new Date("2026-10-04T11:20:00Z") },
      globalPerDay: { count: 3, oldest: new Date("2026-10-04T11:20:00Z") },
    },
    now,
  );
  assert.ok(r.limited);
  if (r.limited) {
    assert.deepEqual(r.exceeded, ["ipPerHour"]);
    assert.equal(r.retryAfterSeconds, 20 * 60);
  }
});

test("checkRateLimit: ngắt mạch toàn hệ thống, lấy thời gian chờ dài nhất", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const r = checkRateLimit(
    {
      ipPerHour: { count: 3, oldest: new Date("2026-10-04T11:59:00Z") },
      ipPerDay: { count: 3, oldest: new Date("2026-10-04T11:00:00Z") },
      globalPerDay: { count: 30, oldest: new Date("2026-10-03T13:00:00Z") },
    },
    now,
  );
  assert.ok(r.limited);
  if (r.limited) {
    assert.deepEqual(r.exceeded, ["ipPerHour", "globalPerDay"]);
    assert.equal(r.retryAfterSeconds, 3600); // global: 13:00 hôm qua + 24h = 13:00 hôm nay
  }
});

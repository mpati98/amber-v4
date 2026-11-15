// Test parser biểu thức luật kinh tế (không eval) — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileExpr, ExprError, type ExprScope } from "./economy-expr";

const scope: ExprScope = {
  vars: { health: "number", stamina: "number", debuff_active: "boolean" },
  eventFields: { est_hours: "number", on_time: "boolean" },
};
const run = (src: string, e: Record<string, unknown> = {}, vars: Record<string, number | boolean> = {}) =>
  compileExpr(src, scope).run({ vars: { health: 80, stamina: 50, debuff_active: false, ...vars }, e });

test("số học, độ ưu tiên, dấu âm, hàm", () => {
  assert.equal(run("1 + 2 * 3"), 7);
  assert.equal(run("(1 + 2) * 3"), 9);
  assert.equal(run("-min(2 * e.est_hours, 20)", { est_hours: 15 }), -20);
  assert.equal(run("max(1, 5, 3) - abs(-2)"), 3);
  assert.equal(run("10 / 4"), 2.5);
  assert.equal(run("2 - 3 - 4"), -5);
});

test("Python-style if-else, and/or/not, so sánh", () => {
  assert.equal(run("4 * 2 * (1.1 if health >= 70 else 1)"), 8.8);
  assert.equal(run("4 * 2 * (1.1 if health >= 70 else 1)", {}, { health: 69 }), 8);
  assert.equal(run("not e.on_time and stamina >= 40 and not debuff_active", { on_time: false }), true);
  assert.equal(run("not e.on_time and (stamina < 40 or debuff_active)", { on_time: false }), false);
  assert.equal(run("True or False"), true);
  assert.equal(run("1 if False else 2 if True else 3"), 2);
});

test("từ chối mọi thứ ngoài tập con an toàn", () => {
  const bad = [
    "__import__('os')",
    "e.constructor",
    "constructor",
    "toString + 1",
    "e.__proto__",
    "process.exit()",
    "health.toString()",
    "eval(1)",
    "e['x']",
    "1; 2",
    "`x`",
    "health = 1",
    "lambda: 1",
  ];
  for (const src of bad) assert.throws(() => compileExpr(src, scope), ExprError, src);
});

test("kiểm kiểu lúc biên dịch", () => {
  assert.throws(() => compileExpr("health + e.on_time", scope), /cần number/);
  assert.throws(() => compileExpr("e.on_time and 1", scope), /cần boolean/);
  assert.throws(() => compileExpr("1 if health else 2", scope), /Điều kiện/);
  assert.throws(() => compileExpr("1 if e.on_time else False", scope), /Nhánh else/);
  assert.throws(() => compileExpr("unknown_var + 1", scope), /không tồn tại/);
  assert.throws(() => compileExpr("e.nope", scope), /không có trường/);
  assert.throws(() => compileExpr("1 < 2 < 3", scope), /nối chuỗi/);
  assert.throws(() => compileExpr("health", scope, "boolean"), /cần ra boolean/);
  assert.throws(() => compileExpr("min(1)", scope), /Số tham số/);
});

test("lỗi lúc chạy: thiếu trường, chia 0", () => {
  assert.throws(() => run("e.est_hours * 2", {}), /thiếu trường/);
  assert.throws(() => run("1 / (stamina - 50)"), /Chia cho 0/);
});

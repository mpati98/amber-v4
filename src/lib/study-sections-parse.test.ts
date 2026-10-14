// Test tách phần khóa học từ văn bản — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSections } from "./study-sections-parse";

const one = (line: string) => {
  const r = parseSections(line);
  assert.equal(r.skipped.length, 0, `bị bỏ qua: ${line}`);
  assert.equal(r.sections.length, 1);
  return r.sections[0];
};

test("các dạng thời lượng có chữ", () => {
  assert.equal(one("Intro 1h09m").durationMinutes, 69);
  assert.equal(one("Intro 1h 9m").durationMinutes, 69);
  assert.equal(one("Intro 1hr 31min").durationMinutes, 91);
  assert.equal(one("Intro 15hr 31min").durationMinutes, 931);
  assert.equal(one("Intro 1h").durationMinutes, 60);
  assert.equal(one("Intro 46min").durationMinutes, 46);
  assert.equal(one("Intro 32m").durationMinutes, 32);
  assert.equal(one("Intro 1h09m").title, "Intro");
});

test("dạng có dấu hai chấm: phút:giây và giờ:phút:giây, làm tròn phút", () => {
  assert.equal(one("Lesson 9:46").durationMinutes, 10); // 9m46s → 10
  assert.equal(one("Lesson 9:20").durationMinutes, 9); // 9m20s → 9
  assert.equal(one("Lesson 1:04:39").durationMinutes, 65); // 64m39s → 65
  assert.equal(one("Lesson 0:20").durationMinutes, 1); // >0 giây thì tối thiểu 1 phút
  assert.equal(one("Lesson 0:00").durationMinutes, 0);
  assert.equal(one("Lesson 9:46").title, "Lesson");
});

test("dòng Udemy: bỏ 'N lectures •'", () => {
  assert.deepEqual(one("First English Sentences9 lectures • 46min"), { title: "First English Sentences", durationMinutes: 46 });
  assert.deepEqual(one("Basics1 lecture • 1hr 31min"), { title: "Basics", durationMinutes: 91 });
  assert.deepEqual(one("Section 2 12 lectures • 2h 5m"), { title: "Section 2", durationMinutes: 125 });
});

test("bỏ dấu ngăn cuối title", () => {
  assert.equal(one("Intro\t5min").title, "Intro");
  assert.equal(one("Intro - 5min").title, "Intro");
  assert.equal(one("Intro – 5min").title, "Intro");
  assert.equal(one("Intro • 5min").title, "Intro");
  assert.equal(one("Intro · 5min").title, "Intro");
  assert.equal(one("Intro | 5min").title, "Intro");
  assert.equal(one("Intro | - 5min").title, "Intro");
  assert.equal(one("Part-2 5min").title, "Part-2");
});

test("title có chữ số cuối không bị nuốt vào thời lượng", () => {
  assert.deepEqual(one("Chapter 3 5m"), { title: "Chapter 3", durationMinutes: 5 });
  assert.deepEqual(one("Lecture 12 1h 3m"), { title: "Lecture 12", durationMinutes: 63 });
});

test("dòng không có thời lượng → skipped kèm số dòng (từ 1), dòng rỗng vẫn tính số dòng", () => {
  const r = parseSections("A 5min\n\nKhông có giờ\nB 1h\nvẫn không có 5 phút");
  assert.deepEqual(r.sections.map((s) => s.title), ["A", "B"]);
  assert.deepEqual(r.skipped, [
    { line: 3, text: "Không có giờ" },
    { line: 5, text: "vẫn không có 5 phút" },
  ]);
  assert.equal(r.totalMinutes, 65);
});

test("title rỗng hoặc quá dài → skipped", () => {
  const r = parseSections(`46min\n9 lectures • 46min\n${"x".repeat(256)} 5min\n${"x".repeat(255)} 5min`);
  assert.equal(r.sections.length, 1);
  assert.deepEqual(r.skipped.map((s) => s.line), [1, 2, 3]);
});

test("CRLF và khoảng trắng thừa", () => {
  const r = parseSections("  A  5min  \r\n  B 10m \r\n");
  assert.deepEqual(r.sections, [
    { title: "A", durationMinutes: 5 },
    { title: "B", durationMinutes: 10 },
  ]);
  assert.equal(r.totalMinutes, 15);
});

test("văn bản rỗng", () => {
  assert.deepEqual(parseSections(""), { sections: [], skipped: [], totalMinutes: 0 });
});

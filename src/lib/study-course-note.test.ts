import assert from "node:assert/strict";
import test from "node:test";
import { documentJson, noteDocumentContent, noteDocumentTitle } from "./study-course-note";

test("tên tài liệu dùng dấu gạch dài", () => {
  assert.equal(noteDocumentTitle("English Tenses 101"), "English Tenses 101 — Ghi chú");
});

test("nội dung khởi đầu: tiêu đề Markdown + dòng trống", () => {
  assert.equal(noteDocumentContent("English Tenses 101"), "# English Tenses 101\n\n");
});

test("documentJson: tags thành mảng, gập studyCourse thành studyCourseTitle", () => {
  const j = documentJson({ id: "d", tags: '["a"]', studyCourseId: "c", studyCourse: { title: "Khóa A" } });
  assert.deepEqual(j, { id: "d", tags: ["a"], studyCourseId: "c", studyCourseTitle: "Khóa A" });
  assert.equal("studyCourse" in j, false);
});

test("documentJson: không gắn khóa → studyCourseTitle null; tags hỏng → []", () => {
  assert.equal(documentJson({ tags: "không phải json", studyCourseId: null, studyCourse: null }).studyCourseTitle, null);
  assert.deepEqual(documentJson({ tags: "không phải json" }).tags, []);
  assert.equal(documentJson({ tags: "[]" }).studyCourseTitle, null);
});

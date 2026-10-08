// Test hàm dựng tài liệu tổng kết dự án — chạy: npm test (node:test qua tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProjectSummaryDoc, formatDmy, type ProjectSummaryDocInput } from "./project-summary-doc";

const base: ProjectSummaryDocInput = {
  project: { name: "Sự kiện tháng 11", goal: "Tổ chức thành công", startDate: "2026-10-06", endDate: "2026-12-31" },
  keyResults: [
    { name: "Bán vé", mode: "MANUAL", unit: "vé", target: 4, current: 2, linkedTotal: 0, linkedDone: 0, progress: 0.5 },
    { name: "Hoàn thành khâu chuẩn bị", mode: "AUTO", unit: null, target: 0, current: 0, linkedTotal: 3, linkedDone: 1, progress: 1 / 3 },
  ],
  tasks: [
    { title: "Chốt địa điểm", status: "DONE", statusChangedAt: "2026-10-09T03:00:00Z" },
    { title: "Thuê loa", status: "DONE", statusChangedAt: "2026-10-08T03:00:00Z" },
    { title: "In vé", status: "IN_PROGRESS", statusChangedAt: "2026-10-01T03:00:00Z" },
  ],
  finance: { income: 500000, expense: 600000 },
  note: "Làm tốt.",
  // 18:00Z ngày 07/10 = 01:00 ngày 08/10 giờ VN
  closedAt: new Date("2026-10-07T18:00:00Z"),
};

test("formatDmy", () => {
  assert.equal(formatDmy("2026-10-06"), "06/10/2026");
  assert.equal(formatDmy(null), "—");
  assert.equal(formatDmy(undefined), "—");
  assert.equal(formatDmy("xyz"), "—");
});

test("title dùng ngày đóng theo giờ VN", () => {
  assert.equal(buildProjectSummaryDoc(base).title, "Tổng kết dự án: Sự kiện tháng 11 — 08/10/2026");
});

test("content đúng thứ tự và định dạng", () => {
  assert.equal(
    buildProjectSummaryDoc(base).content,
    [
      "Dự án: Sự kiện tháng 11",
      "Mục tiêu: Tổ chức thành công",
      "Thời gian: 06/10/2026 – 31/12/2026 · Đóng ngày 08/10/2026",
      "",
      "Kết quả then chốt",
      "- Bán vé: 2/4 vé (50%)",
      "- Hoàn thành khâu chuẩn bị: 1/3 (33%)",
      "",
      "Việc đã xong (2/3)",
      "- Thuê loa",
      "- Chốt địa điểm",
      "Còn 1 việc chưa xong.",
      "",
      "Thu-chi: Thu 500.000₫ · Chi 600.000₫ · Ròng -100.000₫",
      "",
      "Ghi chú tổng kết",
      "Làm tốt.",
    ].join("\n")
  );
});

test("thiếu dữ liệu: mục tiêu, ngày, KR, ghi chú đều có giá trị thay thế; bỏ dòng 'Còn n việc' khi xong hết", () => {
  const doc = buildProjectSummaryDoc({
    project: { name: "Trống", goal: "  ", startDate: null, endDate: null },
    keyResults: [],
    tasks: [{ title: "A", status: "DONE", statusChangedAt: "2026-10-01T00:00:00Z" }],
    finance: { income: 0, expense: 0 },
    note: "   ",
    closedAt: new Date("2026-10-07T05:00:00Z"),
  });
  assert.match(doc.content, /^Mục tiêu: —$/m);
  assert.match(doc.content, /^Thời gian: — – — · Đóng ngày 07\/10\/2026$/m);
  assert.match(doc.content, /^Không có KR\.$/m);
  assert.match(doc.content, /^Việc đã xong \(1\/1\)$/m);
  assert.doesNotMatch(doc.content, /Còn \d+ việc chưa xong/);
  assert.match(doc.content, /^Thu-chi: Thu 0₫ · Chi 0₫ · Ròng 0₫$/m);
  assert.ok(doc.content.endsWith("Ghi chú tổng kết\n—"));
});

test("không có việc nào xong; việc xong cùng lúc xếp theo tên", () => {
  const none = buildProjectSummaryDoc({ ...base, tasks: [{ title: "X", status: "PREP", statusChangedAt: "2026-10-01T00:00:00Z" }] });
  assert.match(none.content, /^Việc đã xong \(0\/1\)\nChưa có việc nào xong\.\nCòn 1 việc chưa xong\.$/m);
  const same = buildProjectSummaryDoc({
    ...base,
    tasks: [
      { title: "B việc", status: "DONE", statusChangedAt: "2026-10-01T00:00:00Z" },
      { title: "A việc", status: "DONE", statusChangedAt: "2026-10-01T00:00:00Z" },
    ],
  });
  assert.ok(same.content.indexOf("- A việc") < same.content.indexOf("- B việc"));
});

test("KR nhập tay không đơn vị; KR tự đếm chưa gắn việc", () => {
  const doc = buildProjectSummaryDoc({
    ...base,
    keyResults: [
      { name: "Số bài", mode: "MANUAL", unit: null, target: 10, current: 10, linkedTotal: 0, linkedDone: 0, progress: 1 },
      { name: "Tự đếm", mode: "AUTO", unit: null, target: 0, current: 0, linkedTotal: 0, linkedDone: 0, progress: 0 },
    ],
  });
  assert.match(doc.content, /^- Số bài: 10\/10 \(100%\)$/m);
  assert.match(doc.content, /^- Tự đếm: 0\/0 \(0%\)$/m);
});

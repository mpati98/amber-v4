// Test hàm thuần task ats-app — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  atsAttention,
  atsTaskToRow,
  compareAtsTasks,
  dedupeAtsTasks,
  isAtsVisibleByDefault,
  mapAtsStatus,
  nextUpdatedSince,
  retryAfterSeconds,
  shouldSkipDeletion,
} from "./ats-tasks";
import type { AtsTask } from "./ats-client";

test("mapAtsStatus: null→PREP, DOING→IN_PROGRESS, WAITING giữ nhãn riêng, DONE→DONE", () => {
  assert.equal(mapAtsStatus(null), "PREP");
  assert.equal(mapAtsStatus("DOING"), "IN_PROGRESS");
  assert.equal(mapAtsStatus("WAITING"), "WAITING");
  assert.equal(mapAtsStatus("DONE"), "DONE");
  assert.equal(mapAtsStatus("LẠ"), "PREP");
});

test("atsAttention: chỉ OVERDUE khi chưa DONE và hạn < hôm nay", () => {
  const today = "2026-11-17";
  assert.equal(atsAttention({ status: "DOING", dueDate: "2026-11-16" }, today), "OVERDUE");
  assert.equal(atsAttention({ status: "WAITING", dueDate: "2026-01-01" }, today), "OVERDUE");
  assert.equal(atsAttention({ status: null, dueDate: "2026-11-16" }, today), "OVERDUE");
  assert.equal(atsAttention({ status: "DOING", dueDate: today }, today), null, "đúng hôm nay chưa trễ");
  assert.equal(atsAttention({ status: "DONE", dueDate: "2026-11-01" }, today), null);
  assert.equal(atsAttention({ status: "DOING", dueDate: null }, today), null);
});

test("isAtsVisibleByDefault: ẩn project lưu trữ và DONE quá 7 ngày", () => {
  const now = new Date("2026-11-17T05:00:00Z");
  const day = 86_400_000;
  const base = { status: "DOING" as string | null, doneAt: null as Date | null, projectArchived: false };
  assert.equal(isAtsVisibleByDefault(base, now), true);
  assert.equal(isAtsVisibleByDefault({ ...base, projectArchived: true }, now), false);
  assert.equal(isAtsVisibleByDefault({ ...base, status: "DONE", doneAt: new Date(now.getTime() - 7 * day) }, now), true);
  assert.equal(isAtsVisibleByDefault({ ...base, status: "DONE", doneAt: new Date(now.getTime() - 7 * day - 1) }, now), false);
  assert.equal(isAtsVisibleByDefault({ ...base, status: "DONE", doneAt: null }, now), true, "DONE không có done_at thì giữ");
});

test("compareAtsTasks: OVERDUE → mở (hạn tăng dần, null cuối) → DONE (xong gần nhất trước)", () => {
  const t = (atsId: string, o: Partial<Parameters<typeof compareAtsTasks>[0]>) => ({
    atsId,
    attention: null as "OVERDUE" | null,
    rawStatus: "DOING" as string | null,
    dueDate: null as string | null,
    doneAt: null as Date | null,
    ...o,
  });
  const list = [
    t("done-old", { rawStatus: "DONE", doneAt: new Date("2026-11-10T00:00:00Z") }),
    t("open-null", {}),
    t("open-late", { dueDate: "2026-12-01" }),
    t("overdue-2", { attention: "OVERDUE", dueDate: "2026-11-10" }),
    t("done-new", { rawStatus: "DONE", doneAt: new Date("2026-11-15T00:00:00Z") }),
    t("open-soon", { dueDate: "2026-11-20", rawStatus: "WAITING" }),
    t("overdue-1", { attention: "OVERDUE", dueDate: "2026-11-01" }),
  ];
  assert.deepEqual(
    list.sort(compareAtsTasks).map((x) => x.atsId),
    ["overdue-1", "overdue-2", "open-soon", "open-late", "open-null", "done-new", "done-old"]
  );
});

const task = (o: Partial<AtsTask> = {}): AtsTask => ({
  id: "t1",
  title: "Việc",
  status: "DOING",
  dueDate: "2026-11-20",
  doneAt: null,
  createdAt: "2026-11-01T01:00:00.000Z",
  updatedAt: "2026-11-02T01:00:00.000Z",
  project: { id: "p1", name: "Dự án", type: "CAMPAIGN", archived: false },
  ...o,
});

test("atsTaskToRow: đổi ISO sang Date, project null an toàn", () => {
  const r = atsTaskToRow(task({ doneAt: "2026-11-03T00:00:00Z", project: null }));
  assert.equal(r.atsId, "t1");
  assert.equal(r.doneAt?.toISOString(), "2026-11-03T00:00:00.000Z");
  assert.equal(r.atsUpdatedAt.toISOString(), "2026-11-02T01:00:00.000Z");
  assert.deepEqual([r.projectAtsId, r.projectName, r.projectType, r.projectArchived], [null, null, null, false]);
});

test("nextUpdatedSince: lùi 2 phút; lần đầu null", () => {
  assert.equal(nextUpdatedSince(null), null);
  assert.equal(nextUpdatedSince(new Date("2026-11-17T00:00:00Z"))?.toISOString(), "2026-11-16T23:58:00.000Z");
});

test("dedupeAtsTasks: giữ bản updatedAt mới nhất", () => {
  const out = dedupeAtsTasks([task({ title: "cũ" }), task({ id: "t2" }), task({ title: "mới", updatedAt: "2026-11-05T00:00:00Z" })]);
  assert.equal(out.length, 2);
  assert.equal(out.find((t) => t.id === "t1")?.title, "mới");
});

test("shouldSkipDeletion: chỉ chặn khi ats trả rỗng mà bản sao còn dữ liệu", () => {
  assert.equal(shouldSkipDeletion(0, 5), true);
  assert.equal(shouldSkipDeletion(0, 0), false);
  assert.equal(shouldSkipDeletion(3, 5), false);
});

test("retryAfterSeconds", () => {
  const now = new Date("2026-11-17T00:00:30Z");
  assert.equal(retryAfterSeconds(null, 30, now), 0);
  assert.equal(retryAfterSeconds(new Date("2026-11-17T00:00:10Z"), 30, now), 10);
  assert.equal(retryAfterSeconds(new Date("2026-11-17T00:00:00.500Z"), 30, now), 1);
  assert.equal(retryAfterSeconds(new Date("2026-11-16T00:00:00Z"), 30, now), 0);
});

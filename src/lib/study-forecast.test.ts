// Test dự báo ngày xong khóa học — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORECAST_MAX_DAYS, forecast } from "./study-forecast";

// 2026-10-12 là thứ Hai; 2026-10-18 là Chủ nhật.
const base = { today: "2026-10-12", startFromTomorrow: false, videoMinutesPerDay: 40, reviewWeekdays: [7] as number[] };
const sec = (id: string, remainingMinutes: number) => ({ id, title: `T${id}`, remainingMinutes });

test("một khóa vừa trong 1 ngày", () => {
  const r = forecast({ ...base, courses: [{ id: "c1", sections: [sec("a", 15), sec("b", 20)] }] });
  assert.deepEqual(r.days, [
    { date: "2026-10-12", items: [
      { courseId: "c1", sectionId: "a", title: "Ta", minutes: 15 },
      { courseId: "c1", sectionId: "b", title: "Tb", minutes: 20 },
    ] },
  ]);
  assert.equal(r.finishDates.c1, "2026-10-12");
});

test("phần dài kéo sang 2 ngày", () => {
  const r = forecast({ ...base, courses: [{ id: "c1", sections: [sec("a", 30), sec("b", 30)] }] });
  assert.deepEqual(r.days.map((d) => [d.date, d.items.map((i) => `${i.sectionId}:${i.minutes}`)]), [
    ["2026-10-12", ["a:30", "b:10"]],
    ["2026-10-13", ["b:20"]],
  ]);
  assert.equal(r.finishDates.c1, "2026-10-13");
});

test("bỏ qua Chủ nhật ôn tập", () => {
  // 6 ngày thứ Hai→thứ Bảy × 40 = 240; phần 250 phút tràn sang thứ Hai kế tiếp (bỏ Chủ nhật 10-18).
  const r = forecast({ ...base, courses: [{ id: "c1", sections: [sec("a", 250)] }] });
  assert.ok(!r.days.some((d) => d.date === "2026-10-18"));
  assert.equal(r.days[r.days.length - 1].date, "2026-10-19");
  assert.equal(r.finishDates.c1, "2026-10-19");
});

test("bắt đầu từ Chủ nhật ôn tập thì nhảy sang thứ Hai", () => {
  const r = forecast({ ...base, today: "2026-10-18", courses: [{ id: "c1", sections: [sec("a", 10)] }] });
  assert.equal(r.days[0].date, "2026-10-19");
});

test("startFromTomorrow bắt đầu từ ngày mai", () => {
  const r = forecast({ ...base, startFromTomorrow: true, courses: [{ id: "c1", sections: [sec("a", 10)] }] });
  assert.equal(r.days[0].date, "2026-10-13");
  assert.equal(r.finishDates.c1, "2026-10-13");
});

test("nhiều khóa nối tiếp, khóa sau bắt đầu ngay chỗ khóa trước dừng", () => {
  const r = forecast({
    ...base,
    courses: [
      { id: "c1", sections: [sec("a", 50)] },
      { id: "c2", sections: [sec("b", 40)] },
    ],
  });
  assert.equal(r.finishDates.c1, "2026-10-13"); // 40 + 10
  assert.equal(r.finishDates.c2, "2026-10-14"); // 30 còn lại của ngày 13 + 10 sang 14
  assert.deepEqual(r.days[1].items.map((i) => `${i.courseId}:${i.minutes}`), ["c1:10", "c2:30"]);
});

test("phần 0 phút gắn vào ngày hiện tại, không tốn phút", () => {
  const r = forecast({ ...base, courses: [{ id: "c1", sections: [sec("z", 0), sec("a", 40), sec("y", 0)] }] });
  assert.equal(r.days.length, 1);
  assert.deepEqual(r.days[0].items.map((i) => `${i.sectionId}:${i.minutes}`), ["z:0", "a:40", "y:0"]);
  assert.equal(r.finishDates.c1, "2026-10-12");
});

test("khóa không còn phần nào chưa xong → finishDate null", () => {
  const r = forecast({ ...base, courses: [{ id: "c0", sections: [] }, { id: "c1", sections: [sec("a", 10)] }] });
  assert.equal(r.finishDates.c0, null);
  assert.equal(r.finishDates.c1, "2026-10-12");
});

test("vượt giới hạn 1100 ngày → khóa chưa xong có finishDate null", () => {
  const r = forecast({
    ...base,
    reviewWeekdays: [],
    courses: [
      { id: "c1", sections: [sec("a", 40)] },
      { id: "c2", sections: [sec("b", 40 * FORECAST_MAX_DAYS)] }, // vừa đủ 1100 ngày nhưng khóa c1 chiếm 1 ngày
    ],
  });
  assert.equal(r.finishDates.c1, "2026-10-12");
  assert.equal(r.finishDates.c2, null);
  assert.equal(r.days.length, FORECAST_MAX_DAYS);
});

test("đúng 1100 ngày vẫn xong được", () => {
  const r = forecast({ ...base, reviewWeekdays: [], courses: [{ id: "c1", sections: [sec("a", 40 * FORECAST_MAX_DAYS)] }] });
  assert.notEqual(r.finishDates.c1, null);
});

test("mọi ngày đều là ngày ôn → không xếp được gì", () => {
  const r = forecast({ ...base, reviewWeekdays: [1, 2, 3, 4, 5, 6, 7], courses: [{ id: "c1", sections: [sec("a", 10)] }] });
  assert.deepEqual(r.days, []);
  assert.equal(r.finishDates.c1, null);
});

// Test rút gọn dữ liệu Open-Meteo — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { localHour, parseOpenMeteo } from "./weather";

test("localHour: lấy giờ:phút địa phương thành giờ thập phân", () => {
  assert.equal(localHour("2026-11-15T05:45"), 5.75);
  assert.equal(localHour("2026-11-15T17:30"), 17.5);
  assert.throws(() => localHour("17:30"));
});

test("parseOpenMeteo: rút gọn đúng dạng setWeather", () => {
  const w = parseOpenMeteo({
    current: { temperature_2m: 31.24, weather_code: 61, wind_speed_10m: 9.87 },
    daily: { sunrise: ["2026-11-15T05:45"], sunset: ["2026-11-15T17:30"] },
  }, new Date("2026-11-15T03:00:00Z"));
  assert.deepEqual(w, { code: 61, temp: 31.2, wind: 9.9, sunrise: 5.75, sunset: 17.5, source: "Open-Meteo", updatedAt: "2026-11-15T03:00:00.000Z" });
});

test("parseOpenMeteo: thiếu trường → lỗi (route trả 502, không trả dữ liệu sai)", () => {
  assert.throws(() => parseOpenMeteo({ current: { temperature_2m: 30 } }));
  assert.throws(() => parseOpenMeteo(null));
});

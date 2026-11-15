// Thời tiết cho màn chủ 3D: gọi Open-Meteo (miễn phí, không cần khoá) phía server, rút gọn đúng dạng AmberWorld.setWeather().
// Toạ độ: WEATHER_LAT / WEATHER_LON (env); thiếu thì dùng trung tâm TP.HCM (chủ dự án chọn 15/11/2026).

export type WorldWeather = {
  code: number;
  temp: number;
  wind: number;
  /** Giờ thập phân theo giờ VN, vd 5.87 = 05:52 — setWeather nhận số trực tiếp. */
  sunrise: number;
  sunset: number;
  source: string;
  updatedAt: string;
};

const HCMC = { lat: 10.7769, lon: 106.7009 };
const TTL_MS = 15 * 60 * 1000;

/** "2026-11-15T05:52" (giờ địa phương do Open-Meteo trả theo timezone) → 5.8667 */
export function localHour(iso: string): number {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) throw new Error("bad_time");
  return Number(m[1]) + Number(m[2]) / 60;
}

export function parseOpenMeteo(json: unknown, now: Date = new Date()): WorldWeather {
  const j = json as {
    current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number };
    daily?: { sunrise?: string[]; sunset?: string[] };
  };
  const c = j.current, d = j.daily;
  if (!c || typeof c.weather_code !== "number" || typeof c.temperature_2m !== "number" || !d?.sunrise?.[0] || !d?.sunset?.[0]) {
    throw new Error("bad_weather_payload");
  }
  return {
    code: c.weather_code,
    temp: Math.round(c.temperature_2m * 10) / 10,
    wind: Math.round((c.wind_speed_10m ?? 0) * 10) / 10,
    sunrise: localHour(d.sunrise[0]),
    sunset: localHour(d.sunset[0]),
    source: "Open-Meteo",
    updatedAt: now.toISOString(),
  };
}

function coords() {
  const lat = Number(process.env.WEATHER_LAT), lon = Number(process.env.WEATHER_LON);
  return Number.isFinite(lat) && Number.isFinite(lon) && process.env.WEATHER_LAT && process.env.WEATHER_LON ? { lat, lon } : HCMC;
}

// Bộ nhớ đệm theo instance (serverless: mỗi instance tự giữ) — đủ để không gọi Open-Meteo mỗi lần mở màn chủ.
let cache: { at: number; data: WorldWeather } | null = null;

export async function getWeather(now: Date = new Date()): Promise<WorldWeather> {
  if (cache && now.getTime() - cache.at < TTL_MS) return cache.data;
  const { lat, lon } = coords();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + "&current=temperature_2m,weather_code,wind_speed_10m&daily=sunrise,sunset&timezone=Asia%2FHo_Chi_Minh&forecast_days=1";
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) throw new Error(`open_meteo_${res.status}`);
  const data = parseOpenMeteo(await res.json(), now);
  cache = { at: now.getTime(), data };
  return data;
}

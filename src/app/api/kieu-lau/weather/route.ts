import { NextResponse } from "next/server";
import { withAuth } from "@/lib/withAuth";
import { getWeather } from "@/lib/weather";

// Thời tiết hiện tại cho màn chủ 3D (Open-Meteo qua server, giữ đệm 15 phút). Dạng đúng AmberWorld.setWeather().
export const GET = withAuth(async () => {
  try {
    return NextResponse.json(await getWeather(), { headers: { "Cache-Control": "private, max-age=600" } });
  } catch {
    return NextResponse.json({ error: "weather_unavailable" }, { status: 502 });
  }
});

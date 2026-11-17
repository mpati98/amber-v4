import { NextResponse } from "next/server";
import type { AtsSyncOutcome } from "@/lib/ats-sync";

/** Kết cục đồng bộ → HTTP. Dùng chung cho POST /sync và cron. */
export function atsSyncResponse(outcome: AtsSyncOutcome): NextResponse {
  switch (outcome.status) {
    case "ok":
      return NextResponse.json({ result: outcome.counts, sync: outcome.state });
    case "throttled":
      return NextResponse.json(
        { error: "sync_throttled", retryAfterSeconds: outcome.retryAfterSeconds, sync: outcome.state },
        { status: 429, headers: { "Retry-After": String(outcome.retryAfterSeconds) } }
      );
    case "error": {
      // Thiếu cấu hình là lỗi phía mình (503); lỗi từ ats-app (mạng, 401, sai dạng) là 502.
      const status = outcome.error.code === "missing_env" ? 503 : outcome.error.code === "internal" ? 500 : 502;
      const error = outcome.error.code === "missing_env" ? "ats_not_configured" : "ats_sync_failed";
      return NextResponse.json({ error, code: outcome.error.code, message: outcome.error.message, sync: outcome.state }, { status });
    }
  }
}

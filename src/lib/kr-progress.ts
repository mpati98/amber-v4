// Tiến độ của một KR (0..1). Hàm thuần — test ở kr-progress.test.ts.
//   MANUAL: current / target (target 0 thì 0)
//   AUTO:   việc gắn vào KR đã xong / tổng việc gắn vào KR (không có việc nào thì 0)

export type KrMode = "AUTO" | "MANUAL";

export function krProgress(kr: { mode: string; current: number; target: number }, linkedTotal: number, linkedDone: number): number {
  const raw =
    kr.mode === "AUTO"
      ? linkedTotal > 0
        ? linkedDone / linkedTotal
        : 0
      : kr.target > 0
        ? kr.current / kr.target
        : 0;
  return Math.min(1, Math.max(0, raw));
}

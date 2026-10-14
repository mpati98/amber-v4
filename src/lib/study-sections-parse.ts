// Tách danh sách phần của khóa học từ văn bản dán vào (vd copy mục lục Udemy). Hàm thuần — test ở
// study-sections-parse.test.ts.

export type ParsedSection = { title: string; durationMinutes: number };
export type SkippedLine = { line: number; text: string };
export type ParseSectionsResult = { sections: ParsedSection[]; skipped: SkippedLine[]; totalMinutes: number };

/** Cột study_course_sections.title là varchar(255). */
export const MAX_SECTION_TITLE = 255;

// "9:46" = phút:giây, "1:04:39" = giờ:phút:giây. Không bắt số dính liền chữ số/dấu ":" phía trước.
const COLON_DURATION = /(?<![\d:])(\d{1,3}):(\d{2})(?::(\d{2}))?$/;
// "1h09m", "1h 9m", "1hr 31min", "15hr 31min", "1h", "46min", "32m" (+ giây "30s" nếu có).
const UNIT_DURATION =
  /(?<![\d:])(?:(\d+)\s*h(?:rs?|ours?)?\s*)?(?:(\d+)\s*m(?:ins?|inutes?)?\s*)?(?:(\d+)\s*s(?:ecs?|econds?)?)?$/i;
// "9 lectures •", "1 lecture •" (Udemy) — bỏ cả cụm.
const LECTURE_COUNT = /\d+\s*lectures?\s*[•·]\s*/gi;

function toMinutes(totalSeconds: number): number {
  const minutes = Math.round(totalSeconds / 60);
  return totalSeconds > 0 && minutes === 0 ? 1 : minutes;
}

/** Cắt thời lượng ở cuối dòng; null nếu dòng không kết thúc bằng thời lượng. */
function splitDuration(text: string): { head: string; minutes: number } | null {
  const colon = COLON_DURATION.exec(text);
  if (colon) {
    const hasHours = colon[3] !== undefined;
    const seconds = hasHours
      ? Number(colon[1]) * 3600 + Number(colon[2]) * 60 + Number(colon[3])
      : Number(colon[1]) * 60 + Number(colon[2]);
    return { head: text.slice(0, colon.index), minutes: toMinutes(seconds) };
  }
  const unit = UNIT_DURATION.exec(text);
  // Regex khớp được chuỗi rỗng ở cuối dòng — chỉ nhận khi có ít nhất 1 thành phần số.
  if (unit && unit[0].trim() !== "") {
    const seconds = Number(unit[1] ?? 0) * 3600 + Number(unit[2] ?? 0) * 60 + Number(unit[3] ?? 0);
    return { head: text.slice(0, unit.index), minutes: toMinutes(seconds) };
  }
  return null;
}

/** Bỏ dấu ngăn thừa cuối title: tab, " - ", " – ", "•", "·", "|". */
function trimTrailingSeparators(title: string): string {
  let t = title.trim();
  for (;;) {
    const next = t.replace(/[\s•·|]+$/, "").replace(/\s[-–]\s*$/, "").trim();
    if (next === t) return t;
    t = next;
  }
}

export function parseSections(text: string): ParseSectionsResult {
  const sections: ParsedSection[] = [];
  const skipped: SkippedLine[] = [];
  let totalMinutes = 0;

  text.split(/\r?\n/).forEach((raw, index) => {
    const original = raw.trim();
    if (original === "") return;
    const line = index + 1;

    const cleaned = original.replace(LECTURE_COUNT, " ").trim();
    const split = splitDuration(cleaned);
    if (!split) {
      skipped.push({ line, text: original });
      return;
    }
    const title = trimTrailingSeparators(split.head);
    if (title === "" || title.length > MAX_SECTION_TITLE) {
      skipped.push({ line, text: original });
      return;
    }
    sections.push({ title, durationMinutes: split.minutes });
    totalMinutes += split.minutes;
  });

  return { sections, skipped, totalMinutes };
}

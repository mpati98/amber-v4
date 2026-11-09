// Ghi chú theo khóa học (Trà Đình): tên + nội dung khởi đầu của tài liệu và dạng JSON trả về. Hàm thuần, test ở study-course-note.test.ts.
import { parseTags } from "@/lib/tags";

export const noteDocumentTitle = (courseTitle: string): string => `${courseTitle} — Ghi chú`;

/** Một dòng tiêu đề Markdown + dòng trống: đủ để editor mở được, không điền sẵn mẫu dài. */
export const noteDocumentContent = (courseTitle: string): string => `# ${courseTitle}\n\n`;

/**
 * Dạng JSON của tài liệu trả cho client: tags thành mảng, `studyCourse` (quan hệ, không lọc deleted_at) gập thành
 * `studyCourseTitle` (null khi không gắn khóa); `studyCourseId` là cột có sẵn.
 */
export function documentJson<T extends { tags: string; studyCourse?: { title: string } | null }>(item: T) {
  const { studyCourse, ...rest } = item;
  return { ...rest, tags: parseTags(item.tags), studyCourseTitle: studyCourse?.title ?? null };
}

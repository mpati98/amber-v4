import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Toàn bộ các bảng Drizzle quản lý sau khi gộp xong Giai đoạn 1 — chỉ còn
  // loại trừ _prisma_migrations (bookkeeping của Prisma, không phải bảng dữ
  // liệu). Danh sách lấy từ information_schema.tables thật, không đoán từ
  // schema.ts.
  tablesFilter: [
    "activity_logs",
    "agent_logs",
    "feed_articles_cache",
    "feed_sources",
    "finance_accounts",
    "finance_balance_snapshots",
    "finance_budgets",
    "finance_categories",
    "finance_transactions",
    "learn_course_details",
    "learn_lessons",
    "practice_messages",
    "practice_session_details",
    "projects",
    "skill_scores",
    "task_occurrences",
    "tasks",
    "topics",
    "users",
    "reading_goals",
    "documents",
    "publications",
    "highlights",
    "refresh_tokens",
    "contact_messages",
    "key_results",
    "checklist_items",
    "routines",
    "routine_logs",
    "workout_exercises",
    "study_subjects",
    "study_courses",
    "study_course_sections",
    "study_logs",
    "study_log_sections",
    "study_day_reasons",
    "music_tracks",
  ],
});

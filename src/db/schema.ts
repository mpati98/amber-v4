import { relations } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

// Enum đổi tên từ "DocumentType" (Prisma) sang "document_type" — 5 giá trị
// giữ nguyên thứ tự thật trong DB.
export const documentType = pgEnum("document_type", ["TEXT", "CHECKLIST", "MINDMAP", "IMAGE", "FILE"]);

// Enum đổi tên từ "PublicationFormat"/"PublicationStatus" (Prisma) sang
// snake_case — giá trị giữ nguyên thứ tự thật trong DB.
export const publicationFormat = pgEnum("publication_format", ["PHYSICAL", "EBOOK", "AUDIOBOOK"]);
export const publicationStatus = pgEnum("publication_status", ["TO_READ", "READING", "READ", "ABANDONED"]);

// ============================================================
// Bảng (định nghĩa hết trước — mọi relations() dồn xuống cuối file
// để tránh lỗi TDZ khi 1 bảng tham chiếu tới bảng định nghĩa sau nó)
// ============================================================

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Refresh token cho Flutter/mobile JWT auth — mỗi row là 1 refresh token đã
// hash (rotation: login/refresh tạo row mới, refresh cũ bị xóa ngay).
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("refresh_tokens_token_hash_unique").on(table.tokenHash)]
);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  color: varchar("color", { length: 32 }),
  // "STANDARD" (dự án task thông thường) | "FINANCE" (tháng) | "LEARN" (khóa học) | ... mở rộng tự do
  type: varchar("type", { length: 32 }).notNull().default("STANDARD"),
  // Chu kỳ của dự án — dùng cho project có vòng đời rõ ràng (Finance: 1 tháng, Learn: ngày bắt đầu/kết thúc khóa)
  startDate: date("start_date"),
  endDate: date("end_date"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  // PREP (chuẩn bị) | WAITING (chờ) | IN_PROGRESS (đang thực thi) | DONE (hoàn thành)
  status: varchar("status", { length: 32 }).notNull().default("PREP"),
  importance: integer("importance").notNull(),
  urgency: integer("urgency").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(15),
  startDate: date("start_date"),
  dueDate: date("due_date"),
  prepLeadDays: integer("prep_lead_days"),
  // Chuỗi RRULE (RFC 5545) cho task lặp lại — null nghĩa là task chỉ xảy ra 1 lần.
  rrule: text("rrule"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const taskOccurrences = pgTable("task_occurrences", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  occurrenceDate: date("occurrence_date").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// ===== Quản lý tài chính cá nhân (dự án đặc biệt, type = "FINANCE") =====

export const financeAccounts = pgTable("finance_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(), // "Ví tiền mặt", "Vietcombank", "Momo"
  type: varchar("type", { length: 32 }).notNull(), // CASH | BANK | E_WALLET | CREDIT_CARD
  currentBalance: numeric("current_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const financeCategories = pgTable("finance_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  icon: varchar("icon", { length: 32 }), // emoji, ví dụ "🍜"
  kind: varchar("kind", { length: 16 }).notNull(), // INCOME | EXPENSE
});

export const financeTransactions = pgTable("finance_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }), // dự án tài chính (tháng) mà giao dịch này thuộc về
  accountId: uuid("account_id")
    .notNull()
    .references(() => financeAccounts.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").references(() => financeCategories.id, { onDelete: "set null" }),
  kind: varchar("kind", { length: 16 }).notNull(), // INCOME | EXPENSE
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(), // luôn dương, dấu quyết định bởi `kind`
  note: text("note"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const financeBudgets = pgTable("finance_budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }), // ngân sách gắn theo dự án tháng
  categoryId: uuid("category_id")
    .notNull()
    .references(() => financeCategories.id, { onDelete: "cascade" }),
  limitAmount: numeric("limit_amount", { precision: 14, scale: 2 }).notNull(),
});

// Chụp tổng số dư tại thời điểm bắt đầu 1 dự án tài chính (tháng) — dùng để vẽ
// biến động số dư qua từng tháng mà không cần dò lại lịch sử giao dịch mỗi lần.
export const financeBalanceSnapshots = pgTable("finance_balance_snapshots", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  totalBalance: numeric("total_balance", { precision: 14, scale: 2 }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===== Học tập (dự án đặc biệt, type = "LEARN") — mỗi khóa học = 1 project =====

export const learnCourseDetails = pgTable("learn_course_details", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  source: varchar("source", { length: 255 }), // "Udemy", "Coursera", "edX"...
  field: varchar("field", { length: 255 }), // lĩnh vực
  outcome: text("outcome"), // kết quả đạt được (chứng chỉ, điểm số, tổng kết)
  // PLANNED (dự định học) | IN_PROGRESS (đang học) | COMPLETED (đã xong)
  status: varchar("status", { length: 32 }).notNull().default("PLANNED"),
});

export const learnLessons = pgTable("learn_lessons", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  studiedAt: date("studied_at"),
  durationMinutes: integer("duration_minutes"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===== Trà Đình — luyện tập tiếng Anh với AI (dự án đặc biệt, type = "PRACTICE") =====

export const practiceSessionDetails = pgTable("practice_session_details", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  mode: varchar("mode", { length: 32 }).notNull(), // CONVERSATION | EXAM_PREP | PROFESSIONAL
  summary: text("summary"), // AI tự tóm tắt buổi học sau khi kết thúc
});

export const practiceMessages = pgTable("practice_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 16 }).notNull(), // USER | ASSISTANT
  content: text("content").notNull(),
  audioUrl: text("audio_url"), // Vercel Blob URL nếu có ghi âm/TTS phát lại
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 1 dòng / kỹ năng / user — cập nhật (không tạo mới) sau mỗi buổi luyện
export const skillScores = pgTable("skill_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  skill: varchar("skill", { length: 32 }).notNull(), // GRAMMAR|VOCABULARY|LISTENING|SPEAKING|READING|WRITING
  cefrLevel: varchar("cefr_level", { length: 4 }), // A1-C2
  score: integer("score"), // 0-100, thang điểm nội bộ để so sánh tiến bộ theo thời gian
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===== Kiều Lâu — trung tâm thông báo + tin tức =====

// Nhật ký hành động dùng chung cho MỌI tòa — lịch sử vĩnh viễn, không phải cảnh báo
export const activityLogs = pgTable("activity_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  source: varchar("source", { length: 32 }).notNull(), // DU_AN | FINANCE | LEARN | TRA_DINH | KIEU_LAU
  action: varchar("action", { length: 64 }).notNull(), // "task.completed", "finance.transaction_created",...
  title: varchar("title", { length: 255 }).notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Nguồn RSS quan tâm — chỉ lưu danh sách nguồn, KHÔNG lưu lịch sử bài viết
export const feedSources = pgTable("feed_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Cache TẠM bài viết mới nhất — mỗi lần "làm mới" XÓA SẠCH cache cũ của
// nguồn đó rồi chèn lại bản mới. KHÔNG tích lũy lịch sử, không có tier lưu
// vĩnh viễn nào cả — đây chỉ là section nhỏ, không phải kho lưu trữ.
export const feedArticlesCache = pgTable("feed_articles_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: uuid("source_id")
    .notNull()
    .references(() => feedSources.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 500 }).notNull(),
  url: text("url").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===== Tàng Kinh Các — Giai đoạn 1 gộp Prisma→Drizzle (Topic trước, đơn giản nhất) =====

// Bảng đổi tên từ "Topic" (Prisma) sang "topics" — id giữ kiểu text (cuid cũ,
// không default ở DB, Prisma sinh id ở app code) để tương thích dữ liệu hiện có,
// KHÔNG dùng uuid().defaultRandom() như các bảng Drizzle khác.
export const topics = pgTable(
  "topics",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
  },
  (table) => [
    // Vật lý là 1 UNIQUE INDEX thuần (Prisma tạo qua CREATE UNIQUE INDEX, không
    // phải UNIQUE CONSTRAINT) — dùng uniqueIndex() thay vì .unique() trên cột để
    // khớp đúng structure thật, tránh drizzle-kit generate báo diff giả sau này.
    uniqueIndex("topics_name_unique").on(table.name),
  ]
);

// Bảng đổi tên từ "ReadingGoal" (Prisma) sang "reading_goals" — id giữ kiểu
// text (cuid cũ, không default ở DB) như topics.
export const readingGoals = pgTable(
  "reading_goals",
  {
    id: text("id").primaryKey(),
    year: integer("year").notNull(),
    targetBooks: integer("targetBooks"),
    targetPages: integer("targetPages"),
    note: text("note"),
  },
  (table) => [
    // "ReadingGoal_year_key" cũng là UNIQUE INDEX thuần, không phải constraint
    // — bài học giống hệt topics.name.
    uniqueIndex("reading_goals_year_unique").on(table.year),
  ]
);

// Bảng đổi tên từ "Document" (Prisma) sang "documents" — id giữ kiểu text
// (cuid cũ, không default ở DB). createdAt/updatedAt là timestamp KHÔNG có
// timezone (khác mọi bảng Drizzle khác trong file — giữ nguyên đúng vật lý,
// không tự thêm withTimezone). tags là cột text chứa chuỗi JSON, không phải
// json/jsonb thật. topicId FK có ON UPDATE CASCADE thật ở DB (Prisma default
// codegen) nên khai rõ onUpdate ở đây, khác các FK khác trong file (vốn do
// chính Drizzle tạo, không có ON UPDATE CASCADE).
export const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  type: documentType("type").notNull().default("TEXT"),
  content: text("content"),
  attachmentUrl: text("attachmentUrl"),
  tags: text("tags").notNull().default("[]"),
  pinned: boolean("pinned").notNull().default(false),
  sourceUrl: text("sourceUrl"),
  topicId: text("topicId").references(() => topics.id, { onDelete: "set null", onUpdate: "cascade" }),
  createdAt: timestamp("createdAt", { mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { mode: "string" }).notNull(),
});

// Bảng đổi tên từ "Publication" (Prisma) sang "publications" — id giữ kiểu
// text (cuid cũ, không default ở DB). Timestamp KHÔNG có timezone, giống
// documents (đã kiểm tra lại riêng, không giả định). "rating" không có
// CHECK constraint ở DB — validate 1-5 (nếu có) chỉ ở tầng ứng dụng, nên
// khai integer() thường, không ràng buộc range ở schema.
export const publications = pgTable("publications", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  author: text("author"),
  isbn: text("isbn"),
  coverUrl: text("coverUrl"),
  format: publicationFormat("format").notNull().default("PHYSICAL"),
  status: publicationStatus("status").notNull().default("TO_READ"),
  rating: integer("rating"),
  currentPage: integer("currentPage"),
  totalPages: integer("totalPages"),
  tags: text("tags").notNull().default("[]"),
  url: text("url"),
  review: text("review"),
  notes: text("notes"),
  dateAdded: timestamp("dateAdded", { mode: "string" }).notNull().defaultNow(),
  dateStarted: timestamp("dateStarted", { mode: "string" }),
  dateFinished: timestamp("dateFinished", { mode: "string" }),
});

// Bảng đổi tên từ "Highlight" (Prisma) sang "highlights" — publicationId
// BẮT BUỘC (khác documents.topicId nullable), FK có ON DELETE CASCADE thật
// ở DB (xóa publication sẽ xóa luôn highlight của nó, không phải SET NULL).
export const highlights = pgTable("highlights", {
  id: text("id").primaryKey(),
  publicationId: text("publicationId")
    .notNull()
    .references(() => publications.id, { onDelete: "cascade", onUpdate: "cascade" }),
  quote: text("quote").notNull(),
  page: integer("page"),
  note: text("note"),
  createdAt: timestamp("createdAt", { mode: "string" }).notNull().defaultNow(),
});

// ===== Liên hệ công khai — tin nhắn từ form trên portfolio (POST /api/public/contact) =====
// Không thuộc user nào (người gửi là khách). Không lưu IP thô: ip_hash =
// HMAC-SHA256(IP, AUTH_SECRET), chỉ để giới hạn tần suất theo người gửi.
export const contactMessages = pgTable(
  "contact_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    message: text("message").notNull(),
    ipHash: text("ip_hash").notNull(),
    emailStatus: text("email_status").notNull(), // sent | failed | skipped
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }), // Amber đánh dấu đã đọc
  },
  (table) => [
    index("contact_messages_ip_hash_created_at_idx").on(table.ipHash, table.createdAt),
    index("contact_messages_created_at_idx").on(table.createdAt),
  ]
);

// ============================================================
// Relations — đặt sau CÙNG, sau khi mọi bảng đã được định nghĩa,
// để tránh lỗi "Cannot access 'X' before initialization" lúc runtime.
// ============================================================

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  tasks: many(tasks),
  skillScores: many(skillScores),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  tasks: many(tasks),
  financeTransactions: many(financeTransactions),
  financeBudgets: many(financeBudgets),
  financeBalanceSnapshot: one(financeBalanceSnapshots, {
    fields: [projects.id],
    references: [financeBalanceSnapshots.projectId],
  }),
  learnLessons: many(learnLessons),
  learnDetails: one(learnCourseDetails, { fields: [projects.id], references: [learnCourseDetails.projectId] }),
  practiceMessages: many(practiceMessages),
  practiceDetails: one(practiceSessionDetails, { fields: [projects.id], references: [practiceSessionDetails.projectId] }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  user: one(users, { fields: [tasks.userId], references: [users.id] }),
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  occurrences: many(taskOccurrences),
}));

export const taskOccurrencesRelations = relations(taskOccurrences, ({ one }) => ({
  task: one(tasks, { fields: [taskOccurrences.taskId], references: [tasks.id] }),
}));

export const financeAccountsRelations = relations(financeAccounts, ({ one, many }) => ({
  user: one(users, { fields: [financeAccounts.userId], references: [users.id] }),
  transactions: many(financeTransactions),
}));

export const financeCategoriesRelations = relations(financeCategories, ({ one, many }) => ({
  user: one(users, { fields: [financeCategories.userId], references: [users.id] }),
  transactions: many(financeTransactions),
  budgets: many(financeBudgets),
}));

export const financeTransactionsRelations = relations(financeTransactions, ({ one }) => ({
  user: one(users, { fields: [financeTransactions.userId], references: [users.id] }),
  project: one(projects, { fields: [financeTransactions.projectId], references: [projects.id] }),
  account: one(financeAccounts, { fields: [financeTransactions.accountId], references: [financeAccounts.id] }),
  category: one(financeCategories, { fields: [financeTransactions.categoryId], references: [financeCategories.id] }),
}));

export const financeBudgetsRelations = relations(financeBudgets, ({ one }) => ({
  user: one(users, { fields: [financeBudgets.userId], references: [users.id] }),
  project: one(projects, { fields: [financeBudgets.projectId], references: [projects.id] }),
  category: one(financeCategories, { fields: [financeBudgets.categoryId], references: [financeCategories.id] }),
}));

export const financeBalanceSnapshotsRelations = relations(financeBalanceSnapshots, ({ one }) => ({
  project: one(projects, { fields: [financeBalanceSnapshots.projectId], references: [projects.id] }),
}));

export const learnCourseDetailsRelations = relations(learnCourseDetails, ({ one, many }) => ({
  project: one(projects, { fields: [learnCourseDetails.projectId], references: [projects.id] }),
  lessons: many(learnLessons),
}));

export const learnLessonsRelations = relations(learnLessons, ({ one }) => ({
  project: one(projects, { fields: [learnLessons.projectId], references: [projects.id] }),
}));

export const practiceSessionDetailsRelations = relations(practiceSessionDetails, ({ one }) => ({
  project: one(projects, { fields: [practiceSessionDetails.projectId], references: [projects.id] }),
}));

export const practiceMessagesRelations = relations(practiceMessages, ({ one }) => ({
  project: one(projects, { fields: [practiceMessages.projectId], references: [projects.id] }),
}));

export const skillScoresRelations = relations(skillScores, ({ one }) => ({
  user: one(users, { fields: [skillScores.userId], references: [users.id] }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  user: one(users, { fields: [activityLogs.userId], references: [users.id] }),
}));

export const feedSourcesRelations = relations(feedSources, ({ many }) => ({
  articles: many(feedArticlesCache),
}));

export const feedArticlesCacheRelations = relations(feedArticlesCache, ({ one }) => ({
  source: one(feedSources, { fields: [feedArticlesCache.sourceId], references: [feedSources.id] }),
}));

export const topicsRelations = relations(topics, ({ many }) => ({
  documents: many(documents),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  topic: one(topics, { fields: [documents.topicId], references: [topics.id] }),
}));

export const publicationsRelations = relations(publications, ({ many }) => ({
  highlights: many(highlights),
}));

export const highlightsRelations = relations(highlights, ({ one }) => ({
  publication: one(publications, { fields: [highlights.publicationId], references: [publications.id] }),
}));

// Phần của nhật ký amber-brain có đụng DB: cột tóm tắt cho danh sách và điều kiện "đủ điều kiện làm mẫu".
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { agentLogs } from "@/db/schema";
import { UNKNOWN_GRACE_DAYS } from "@/lib/brain-logs";

/** Các trường tóm tắt của màn danh sách (không kéo messages/tools/raw_output nặng). */
export const summaryColumns = {
  id: agentLogs.id,
  createdAt: agentLogs.createdAt,
  agent: agentLogs.agent,
  source: agentLogs.source,
  userInput: agentLogs.userInput,
  outcome: agentLogs.outcome,
  route: agentLogs.route,
  cloudModel: agentLogs.cloudModel,
  toolName: agentLogs.toolName,
  toolOk: agentLogs.toolOk,
  parseOk: agentLogs.parseOk,
  hasCorrection: sql<boolean>`${agentLogs.correctedOutput} is not null`.as("has_correction"),
  excludeFromTraining: agentLogs.excludeFromTraining,
};

/** Cột của một dòng đầy đủ: bỏ userId (không cần trả ra ngoài). */
export const { userId: _omitUserId, ...fullColumns } = getTableColumns(agentLogs);

/**
 * Quy tắc "mẫu đủ điều kiện" — PHẢI khớp scripts/export_dataset.py của amber-brain (select_rows + bỏ dòng không có đáp án):
 * không bị loại khỏi dataset, có messages + câu user + đáp án (corrected_output hoặc parsed_output), và
 * có bản sửa, outcome accepted/corrected, hoặc unknown mà tool_ok và đã quá UNKNOWN_GRACE_DAYS ngày.
 */
const eligiblePrerequisites = and(
  eq(agentLogs.excludeFromTraining, false),
  sql`${agentLogs.messages} is not null`,
  sql`${agentLogs.userInput} <> ''`,
  sql`coalesce(${agentLogs.correctedOutput}, ${agentLogs.parsedOutput}) is not null`,
)!;

export const ELIGIBLE_REASONS = ["confirmed", "corrected", "user_rated"] as const;
export type EligibleReason = (typeof ELIGIBLE_REASONS)[number];

/**
 * The single source of truth for eligibility and its explanation:
 * corrected output, user-rated/brain-corrected outcome, or an old successful unknown turn.
 */
export const eligibleReason = sql<EligibleReason | null>`CASE
  WHEN ${eligiblePrerequisites} THEN CASE
    WHEN ${agentLogs.correctedOutput} IS NOT NULL THEN ${ELIGIBLE_REASONS[1]}
    WHEN ${agentLogs.outcome} = 'accepted' THEN ${ELIGIBLE_REASONS[2]}
    WHEN ${agentLogs.outcome} = 'corrected' THEN ${ELIGIBLE_REASONS[1]}
    WHEN ${agentLogs.outcome} = 'unknown'
      AND ${agentLogs.toolOk} = true
      AND ${agentLogs.createdAt} <= now() - (${UNKNOWN_GRACE_DAYS} * interval '1 day')
      THEN ${ELIGIBLE_REASONS[0]}
    ELSE NULL
  END
  ELSE NULL
END`;

export const eligibleCondition = sql`${eligibleReason} IS NOT NULL`;

/** Khóa bỏ trùng như export: (câu user + đáp án). */
export const dedupeKey = sql`${agentLogs.userInput} || chr(1) || coalesce(${agentLogs.correctedOutput}, ${agentLogs.parsedOutput})::text`;

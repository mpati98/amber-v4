import { phraseKey } from "@/lib/study-card-key";

// Đọc và kiểm tra mảng thẻ từ vựng Claude trả về (dán ở màn Nhập thẻ). Hàm thuần, không đụng DB —
// test ở study-card-parse.test.ts. Trùng với thẻ đã có trong kho do route import kiểm tra sau.

export const CARD_KINDS = ["PHRASAL_VERB", "COLLOCATION", "IDIOM", "PATTERN", "EXPRESSION"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const MAX_CARDS_PER_IMPORT = 100;
export const MAX_TOPICS_PER_CARD = 3;
export const MAX_PHRASE_LENGTH = 255;

export type ParsedCard = { phrase: string; phraseKey: string; meaning: string; example: string; note: string | null; kind: CardKind; topics: string[] };
/** index = vị trí (từ 0) của phần tử trong mảng; null = lỗi của cả đầu vào. */
export type CardParseError = { index: number | null; field: string | null; reason: string };
export type CardDuplicate = { index: number; phrase: string; firstIndex: number };
export type CardParseResult = { cards: ParsedCard[]; errors: CardParseError[]; duplicates: CardDuplicate[] };

const text = (v: unknown): string | null => (typeof v === "string" ? v.trim() : null);

/** Bỏ rào ```json ... ``` nếu người dùng dán nguyên khối code từ Claude. */
function stripFence(raw: string): string {
  const m = raw.trim().match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
  return (m ? m[1] : raw).trim();
}

/** Đọc chuỗi dán vào: JSON không hợp lệ hoặc không phải mảng → một lỗi cấp đầu vào, không có thẻ nào. */
export function parseCardsText(raw: string): CardParseResult {
  let value: unknown;
  try {
    value = JSON.parse(stripFence(raw));
  } catch {
    return { cards: [], errors: [{ index: null, field: null, reason: "invalid_json" }], duplicates: [] };
  }
  return parseCards(value);
}

/**
 * Kiểm tra từng phần tử. cards = thẻ hợp lệ, không trùng khoá trong đầu vào (giữ thẻ đầu tiên);
 * errors = mọi lỗi theo vị trí và trường; duplicates = phần tử sau trùng phrase_key với phần tử trước.
 * Phần tử đã lỗi không vào cards và không tham gia xét trùng.
 */
export function parseCards(value: unknown): CardParseResult {
  const result: CardParseResult = { cards: [], errors: [], duplicates: [] };
  if (!Array.isArray(value)) {
    result.errors.push({ index: null, field: null, reason: "not_array" });
    return result;
  }
  if (value.length > MAX_CARDS_PER_IMPORT) {
    result.errors.push({ index: null, field: null, reason: "too_many_cards" });
    return result;
  }

  const firstIndexByKey = new Map<string, number>();
  value.forEach((item, index) => {
    const err = (field: string | null, reason: string) => result.errors.push({ index, field, reason });
    if (typeof item !== "object" || item === null || Array.isArray(item)) return err(null, "not_object");
    const o = item as Record<string, unknown>;
    const before = result.errors.length;

    const phrase = text(o.phrase);
    if (!phrase) err("phrase", "required");
    else if (phrase.length > MAX_PHRASE_LENGTH) err("phrase", "too_long");
    else if (phrase.split(/\s+/).length < 2) err("phrase", "single_word"); // kho chỉ có cụm, không có từ đơn

    const meaning = text(o.meaning);
    if (!meaning) err("meaning", "required");
    const example = text(o.example);
    if (!example) err("example", "required");

    let note: string | null = null;
    if (o.note !== undefined && o.note !== null) {
      if (typeof o.note !== "string") err("note", "invalid");
      else note = o.note.trim() || null;
    }

    if (typeof o.kind !== "string" || !(CARD_KINDS as readonly string[]).includes(o.kind)) err("kind", "invalid");

    let topics: string[] = [];
    if (o.topics !== undefined && o.topics !== null) {
      if (!Array.isArray(o.topics) || o.topics.some((t) => typeof t !== "string")) err("topics", "invalid");
      else {
        topics = [...new Set((o.topics as string[]).map((t) => t.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean))];
        if (topics.length > MAX_TOPICS_PER_CARD) err("topics", "too_many");
      }
    }

    if (result.errors.length > before) return;
    const key = phraseKey(phrase!);
    const first = firstIndexByKey.get(key);
    if (first !== undefined) {
      result.duplicates.push({ index, phrase: phrase!, firstIndex: first });
      return;
    }
    firstIndexByKey.set(key, index);
    result.cards.push({ phrase: phrase!, phraseKey: key, meaning: meaning!, example: example!, note, kind: o.kind as CardKind, topics });
  });
  return result;
}

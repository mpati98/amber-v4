import { phraseKey } from "@/lib/study-card-key";

// Đọc và kiểm tra mảng thẻ từ vựng Claude trả về (dán ở màn Nhập thẻ). Hàm thuần, không đụng DB —
// test ở study-card-parse.test.ts. Trùng với thẻ đã có trong kho do route import kiểm tra sau.

export const CARD_KINDS = ["PHRASAL_VERB", "COLLOCATION", "IDIOM", "PATTERN", "EXPRESSION"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const MAX_CARDS_PER_IMPORT = 100;
export const MAX_TOPICS_PER_CARD = 3;
export const MAX_PHRASE_LENGTH = 255;
export const MAX_PRONUNCIATION_LENGTH = 100;

export type CardFields = { phrase: string; phraseKey: string; meaning: string; example: string; note: string | null; pronunciation: string | null; kind: CardKind; topics: string[] };
/** index = vị trí (từ 0) của thẻ trong mảng đầu vào. */
export type ParsedCard = CardFields & { index: number };
/** index = vị trí (từ 0) của phần tử trong mảng; null = lỗi của cả đầu vào. */
export type CardParseError = { index: number | null; field: string | null; reason: string };
export type CardDuplicate = { index: number; phrase: string; firstIndex: number };
export type CardParseResult = { cards: ParsedCard[]; errors: CardParseError[]; duplicates: CardDuplicate[] };
export type CardFieldError = { field: string | null; reason: string };
export type CardValidation = { ok: true; card: CardFields } | { ok: false; errors: CardFieldError[] };

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
 * Kiểm tra MỘT thẻ (dùng chung cho thêm tay, sửa, nhập hàng loạt). Trả mọi lỗi theo trường; hợp lệ thì trả thẻ đã
 * chuẩn hoá (cắt khoảng trắng, phrase_key, topics chữ thường không trùng).
 */
export function validateCard(item: unknown): CardValidation {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return { ok: false, errors: [{ field: null, reason: "not_object" }] };
  const o = item as Record<string, unknown>;
  const errors: CardFieldError[] = [];
  const err = (field: string, reason: string) => errors.push({ field, reason });

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

  let pronunciation: string | null = null;
  if (o.pronunciation !== undefined && o.pronunciation !== null) {
    if (typeof o.pronunciation !== "string") err("pronunciation", "invalid");
    else {
      pronunciation = o.pronunciation.trim() || null;
      if (pronunciation !== null && pronunciation.length > MAX_PRONUNCIATION_LENGTH) err("pronunciation", "too_long");
    }
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

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, card: { phrase: phrase!, phraseKey: phraseKey(phrase!), meaning: meaning!, example: example!, note, pronunciation, kind: o.kind as CardKind, topics } };
}

/** Nhập hàng loạt: phiên âm quá dài thì bỏ riêng trường đó, vẫn giữ thẻ. */
function dropLongPronunciation(item: unknown): unknown {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return item;
  const p = (item as Record<string, unknown>).pronunciation;
  if (typeof p === "string" && p.trim().length > MAX_PRONUNCIATION_LENGTH) return { ...item, pronunciation: null };
  return item;
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
    const v = validateCard(dropLongPronunciation(item));
    if (!v.ok) {
      for (const e of v.errors) result.errors.push({ index, ...e });
      return;
    }
    const first = firstIndexByKey.get(v.card.phraseKey);
    if (first !== undefined) {
      result.duplicates.push({ index, phrase: v.card.phrase, firstIndex: first });
      return;
    }
    firstIndexByKey.set(v.card.phraseKey, index);
    result.cards.push({ ...v.card, index });
  });
  return result;
}

// Test đọc/kiểm tra mảng thẻ từ vựng — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CARDS_PER_IMPORT, parseCards, parseCardsText, validateCard } from "./study-card-parse";

const ok = { phrase: "look forward to", meaning: "to be excited about a future event", example: "I look forward to the trip.", kind: "PHRASAL_VERB" };

test("thẻ hợp lệ: chuẩn hoá khoá, note và topics mặc định", () => {
  const r = parseCards([{ ...ok, phrase: "  Look  Forward To " }]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.cards.length, 1);
  assert.equal(r.cards[0].phrase, "Look  Forward To");
  assert.equal(r.cards[0].phraseKey, "look forward to");
  assert.equal(r.cards[0].note, null);
  assert.deepEqual(r.cards[0].topics, []);
});

test("topics: cắt, chữ thường, bỏ trùng và rỗng", () => {
  const r = parseCards([{ ...ok, topics: [" Travel ", "travel", "", "Daily  Life"] }]);
  assert.deepEqual(r.cards[0].topics, ["travel", "daily life"]);
});

test("topics: quá 3 là lỗi", () => {
  const r = parseCards([{ ...ok, topics: ["a", "b", "c", "d"] }]);
  assert.equal(r.cards.length, 0);
  assert.deepEqual(r.errors, [{ index: 0, field: "topics", reason: "too_many" }]);
});

test("lỗi theo vị trí và trường; thẻ đúng vẫn được giữ", () => {
  const r = parseCards([ok, { ...ok, meaning: " " }, { ...ok, kind: "WORD" }, "x", { ...ok, phrase: "hello" }]);
  assert.equal(r.cards.length, 1);
  assert.deepEqual(r.errors, [
    { index: 1, field: "meaning", reason: "required" },
    { index: 2, field: "kind", reason: "invalid" },
    { index: 3, field: null, reason: "not_object" },
    { index: 4, field: "phrase", reason: "single_word" },
  ]);
});

test("nhiều lỗi trong một thẻ đều được báo", () => {
  const r = parseCards([{ kind: "IDIOM" }]);
  assert.deepEqual(r.errors.map((e) => e.field), ["phrase", "meaning", "example"]);
});

test("phrase quá 255 ký tự", () => {
  const r = parseCards([{ ...ok, phrase: "a ".repeat(130) }]);
  assert.deepEqual(r.errors, [{ index: 0, field: "phrase", reason: "too_long" }]);
});

test("trùng khoá trong đầu vào: giữ thẻ đầu, báo thẻ sau", () => {
  const r = parseCards([ok, { ...ok, phrase: "LOOK forward   to", meaning: "khác" }, { ...ok, phrase: "break the ice" }]);
  assert.deepEqual(r.cards.map((c) => c.phrase), ["look forward to", "break the ice"]);
  assert.deepEqual(r.duplicates, [{ index: 1, phrase: "LOOK forward   to", firstIndex: 0 }]);
});

test("thẻ lỗi không làm các thẻ sau bị coi là trùng", () => {
  const r = parseCards([{ ...ok, kind: "X" }, ok]);
  assert.equal(r.cards.length, 1);
  assert.deepEqual(r.duplicates, []);
});

test("tối đa 100 thẻ", () => {
  const many = Array.from({ length: MAX_CARDS_PER_IMPORT }, (_, i) => ({ ...ok, phrase: `phrase number ${i}` }));
  assert.equal(parseCards(many).cards.length, 100);
  const r = parseCards([...many, ok]);
  assert.equal(r.cards.length, 0);
  assert.deepEqual(r.errors, [{ index: null, field: null, reason: "too_many_cards" }]);
});

test("không phải mảng / JSON hỏng", () => {
  assert.deepEqual(parseCards({}).errors, [{ index: null, field: null, reason: "not_array" }]);
  assert.deepEqual(parseCardsText("[{").errors, [{ index: null, field: null, reason: "invalid_json" }]);
});

test("parseCardsText: bỏ rào ```json", () => {
  const r = parseCardsText("```json\n" + JSON.stringify([ok]) + "\n```");
  assert.equal(r.cards.length, 1);
});

test("note: chuỗi rỗng thành null, sai kiểu là lỗi", () => {
  assert.equal(parseCards([{ ...ok, note: "  " }]).cards[0].note, null);
  assert.deepEqual(parseCards([{ ...ok, note: 5 }]).errors, [{ index: 0, field: "note", reason: "invalid" }]);
});

test("validateCard: một thẻ hợp lệ được chuẩn hoá, thẻ lỗi trả mọi lỗi theo trường", () => {
  const good = validateCard({ ...ok, phrase: " Look  Forward To ", topics: [" Travel "] });
  assert.ok(good.ok);
  if (good.ok) assert.deepEqual([good.card.phraseKey, good.card.topics], ["look forward to", ["travel"]]);
  const bad = validateCard({ phrase: "hello", kind: "X" });
  assert.ok(!bad.ok);
  if (!bad.ok) assert.deepEqual(bad.errors.map((e) => e.field), ["phrase", "meaning", "example", "kind"]);
  assert.deepEqual(validateCard(null), { ok: false, errors: [{ field: null, reason: "not_object" }] });
});

test("parseCards: mỗi thẻ hợp lệ mang index gốc trong đầu vào", () => {
  const r = parseCards([{ ...ok, kind: "X" }, ok, { ...ok, phrase: "break the ice" }]);
  assert.deepEqual(r.cards.map((c) => c.index), [1, 2]);
});

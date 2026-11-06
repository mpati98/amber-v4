// Khoá chống trùng của thẻ từ vựng: cụm đã chuẩn hoá. Hàm thuần — test ở study-card-key.test.ts.

/** Cắt hai đầu, chữ thường, gộp mọi khoảng trắng liên tiếp thành một dấu cách. Dùng cho cột phrase_key. */
export function phraseKey(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

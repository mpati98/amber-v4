# Trà Đình – Kho thẻ từ vựng: thiết kế và kế hoạch tích hợp vào Amber v4

Lập ngày 04/11/2026; chốt thiết kế ngày 04/11/2026 (bản 8, bước 1 đến 9 xong trên dev, chờ thử tay và production). Vị trí trong repo: `amber-v4/docs/tra-dinh-the-tu-vung-ke-hoach.md`, cùng chỗ với hai kế hoạch Trà Đình và Nghị Sự Đường. Mockup tham chiếu: canvas "Trà Đình — Kho thẻ từ vựng" (6 artboard: 1 Ôn thẻ mặt trước, 2 Ôn thẻ mặt sau, 3 Kho thẻ, 4 Nhập thẻ từ Claude, 5 Thống kê nhóm khó, 6 Kết thúc phiên ôn).

Phạm vi: kho cụm từ, ôn lặp lại ngắt quãng, ghi phút ôn thẻ và thống kê nhóm khó, nằm trong phần Học tập của Trà Đình, gắn với môn học và buổi học đã có. Không gồm: tóm tắt transcript bằng Claude (làm ngoài app, dán kết quả vào), nhật ký speaking/writing, lịch hai khóa Udemy, nhập thẻ qua amber-brain, luyện chat AI.

## 1. Mô hình đã chốt

- Một thẻ = một cụm từ (từ cụm trở lên, không có từ đơn) + nghĩa tiếng Anh + một câu ví dụ chứa cụm đó + ghi chú tuỳ chọn + **loại** + vài **chủ đề**. Không có nghĩa tiếng Việt.
- Một kiểu hỏi: mặt trước là câu ví dụ che cụm kèm gợi ý nghĩa tiếng Anh; mặt sau là cụm, câu đầy đủ, nguồn, ghi chú.
- Thẻ thuộc một môn học (`study_subjects`). Nguồn tuỳ chọn: buổi học (`study_logs`).
- Chống trùng: so khớp cụm đã chuẩn hoá (chữ thường, bỏ khoảng trắng thừa) trong cùng môn; nhập hàng loạt thì bỏ qua thẻ trùng và báo số lượng.
- Ba mức đánh giá: Chưa nhớ · Cần ôn lại · Đã nhớ.
- **Giới hạn cứng 20 thẻ khác nhau mỗi ngày** (gồm cả thẻ đến hạn theo lịch). Thẻ Chưa nhớ quay lại sau 5 phút vẫn là cùng một thẻ, không tính thêm.
- Ngày, tháng, quý tính theo giờ VN và dương lịch. Ngày ôn tập dùng lại cột "các thứ ôn tập" của môn (mặc định Chủ nhật).
- Tạm dừng và xoá thẻ được. Mọi lượt đánh giá đều được ghi lại.

## 2. Lịch ôn theo giai đoạn (hàm thuần `study-card-schedule`, có unit test)

Các giai đoạn (`stage`): `NEW` → `LEARNING` → `WEEKLY` → `MONTHLY` → `QUARTERLY`.

| Mức chọn | Kết quả |
|---|---|
| Chưa nhớ | Về `LEARNING`, đến hạn sau 5 phút (từ bất kỳ giai đoạn nào). |
| Cần ôn lại | Về `LEARNING`, đến hạn vào đầu ngày hôm sau. |
| Đã nhớ, đang `NEW` hoặc `LEARNING` | Sang `WEEKLY`, đến hạn vào ngày ôn tập kế tiếp (sau hôm nay). |
| Đã nhớ, đang `WEEKLY` | Sang `MONTHLY`, đến hạn vào ngày ôn tập đầu tiên của tháng dương lịch kế tiếp. |
| Đã nhớ, đang `MONTHLY` | Sang `QUARTERLY`, đến hạn vào ngày ôn tập đầu tiên của quý dương lịch kế tiếp. |
| Đã nhớ, đang `QUARTERLY` | Giữ `QUARTERLY`, lặp lại như dòng trên, mãi mãi. |

- Thẻ ôn ở quý nào thì lần sau rơi vào quý kế tiếp, nên mỗi thẻ lặp lại ít nhất một lần mỗi quý.
- Môn chưa đặt thứ ôn tập thì dùng Chủ nhật.
- Hàm ngày giờ mới (đầu ngày VN, tháng kế tiếp, mốc quý, ngày ôn tập kế tiếp) đặt trong `src/lib/vn-time.ts` cạnh `vnMonthBounds`; hiện file đó chỉ có `vnToday`, `vnYear`, `vnMonthBounds`. Các hàm thuần khác đặt cạnh `study-forecast.ts` và `study-pending.ts` trong `src/lib/`, mỗi hàm có `.test.ts` không cần DB.
- Server tính sẵn `next` cho từng thẻ (thời điểm đến hạn nếu chọn mỗi mức) để nút hiện đúng nhãn: "5 phút", "Ngày mai", "CN 08/11", "Tháng 12", "Quý 1/2027".
- **Ôn thêm** (thẻ thuộc nhóm khó hoặc ngẫu nhiên, mục 3): Chưa nhớ và Cần ôn lại áp dụng như bảng trên (thẻ về `LEARNING`); **Đã nhớ không đổi giai đoạn và hạn của thẻ**. Chỉ lượt ôn đầu tiên trong ngày của một thẻ mới tính là ôn thêm; lượt ôn sau đó trong cùng ngày (thẻ quay lại sau Chưa nhớ) tính như bình thường, để thẻ lên được mốc hàng tuần.

## 3. Phân bố 20 thẻ mỗi ngày (phương án A, điều chỉnh sau nếu cần)

Kế hoạch ngày được tạo một lần khi mở hàng đợi lần đầu trong ngày và lưu lại, nên tải lại vẫn ra cùng danh sách. Thuật toán (hàm thuần `study-card-queue`, có unit test):

1. **Đến hạn** (`DUE`): thẻ chưa tạm dừng có `due_at` đến hết hôm nay (giờ VN), xếp theo `due_at` tăng dần (quá hạn lâu nhất trước), lấy tối đa 20. Thẻ còn dư dồn sang ngày sau.
2. Phần còn lại R = 20 − số thẻ đến hạn được lấy. Chia: khó = làm tròn 20% R, ngẫu nhiên = làm tròn 10% R, mới = phần còn lại (xấp xỉ 70%).
3. **Mới** (`NEW`): thẻ `NEW` chưa tạm dừng, theo thứ tự tạo.
4. **Khó** (`HARD`): thẻ không phải `NEW`, chưa tạm dừng, không đến hạn hôm nay, có từ 2 lượt Chưa nhớ trong 30 ngày; xếp theo tỷ lệ Chưa nhớ giảm dần, bằng nhau thì thẻ ôn lâu nhất trước.
5. **Ngẫu nhiên** (`RANDOM`): thẻ không phải `NEW`, chưa tạm dừng, không đến hạn hôm nay, không nằm trong nhóm khó; chọn ngẫu nhiên.
6. Thiếu ở một loại thì bù theo thứ tự mới → khó → ngẫu nhiên; vẫn thiếu thì thôi, không ép đủ 20.
7. Khi có nhiều thẻ đến hạn thì số thẻ mới tự giảm, có thể về 0 cho tới khi hết dồn. Màn ôn hiện dòng "Đang ưu tiên ôn thẻ cũ" lúc đó.
8. Kế hoạch chưa đủ 20 mà có thêm thẻ khả dụng (ví dụ vừa nhập thẻ mới) thì bù thêm vào kế hoạch ngày theo thứ tự mới → khó → ngẫu nhiên.
9. Chỉ ôn được thẻ nằm trong kế hoạch hôm nay; ngoài kế hoạch thì 409 `not_in_today_plan`. Đây là giới hạn cứng 20.
10. Thẻ bị tạm dừng trong kế hoạch hôm nay không tính vào số đã làm, còn lại và hàng đợi, nhưng vẫn chiếm chỗ trong 20 khi bù thẻ.
11. Kế hoạch không lưu thứ tự; hàng đợi dùng thứ tự dẫn xuất: đến hạn (theo `due_at`), mới, khó, ngẫu nhiên (theo ngày tạo thẻ, bằng nhau theo id). Một thẻ Chưa nhớ quay lại khi `due_at` đến; hết hôm nay thì tính là đã xong và sang kế hoạch ngày mai.

Ước tính thô để tham khảo: tuần đầu đến hạn 0–5 (mới 10–14/ngày); tháng 2–3 đến hạn 12–18 (mới 2–6/ngày); sau 1 năm đến hạn 17–20 (mới 0–3/ngày). Kho thẻ tối đa về lý thuyết khoảng 1.800 thẻ vì mốc quý đã chiếm khoảng 1% kho mỗi ngày.

## 4. Phút ôn thẻ tính vào mục tiêu ngày

- Người dùng gõ tay số phút khi kết thúc phiên ôn (artboard 6) hoặc trong form buổi học.
- Lưu thành một buổi học: `study_logs.activity` (enum `study_log_activity`: `LESSON` mặc định, `CARD_REVIEW`). Buổi `CARD_REVIEW` có số phút 1–1440, không có khóa và các phần; cộng vào mục tiêu phút/ngày của môn như buổi thường. Có thể có nhiều buổi mỗi ngày; sửa và xoá trong ngày như hiện nay.
- Bên dưới ô nhập có thanh "30 phút học bài + 15 phút ôn thẻ = 45 / 60". Số thẻ đã ôn hôm nay lấy từ `study_card_reviews`, chỉ để tham khảo.
- Kết quả khảo sát (06/11) và quyết định cho từng chỗ đọc `study_logs`:
  - `dayTotals` (`study-days.ts`; tổng tuần, lịch, mục tiêu ngày, lý do chưa đủ): tính cả phút `CARD_REVIEW` (đã chốt).
  - Chuỗi ngày routine STUDY và `pendingReasonDates`: theo tổng phút của ngày nên tự tính cả phút ôn thẻ; ngày chỉ tính là xong khi đạt mục tiêu.
  - `forecastSubject` (`study-courses.ts`, "hôm nay có buổi thì lịch bắt đầu từ mai"): chỉ tính buổi `LESSON`, bỏ qua `CARD_REVIEW`.
  - `stats` (`byCourse`): buổi `CARD_REVIEW` hiện thành mục riêng "Ôn thẻ", không gộp vào "Ôn tập".
  - `logViews`, `schedule`, `overview`, `recentLogs` của khóa: không lỗi với khóa null; bước 5 kiểm tra mô hình Flutter của lịch nhận `courseTitle` null.
  - `PATCH/DELETE /logs/[id]`: cho sửa số phút và xoá trong ngày; không cho đổi `activity`, không cho gắn `courseId` hay các phần vào buổi `CARD_REVIEW`.

## 5. Nhập thẻ

- Claude (ngoài app) đọc transcript và trả một mảng JSON; người dùng dán vào màn Nhập thẻ. App không gọi LLM.
- Mỗi phần tử: `{phrase, meaning, example, note?, kind, topics?}`. `kind` bắt buộc, thuộc 5 giá trị ở mục 6; `topics` tối đa 3, chữ thường. Tối đa 100 thẻ mỗi lần.
- Xem trước: số thẻ hợp lệ, thẻ trùng (bỏ qua), dòng lỗi (phải sửa trước khi lưu). Loại hiện viền vàng, chủ đề hiện xám.
- Gắn được vào một buổi học (`logId` tuỳ chọn). Thêm và sửa từng thẻ bằng sheet nhỏ (mở bằng `showFinanceSheet`).

## 6. Nhóm thẻ: hai trục khác nhau

- **Loại** (`kind`, enum `study_card_kind`, mỗi thẻ đúng một loại): `PHRASAL_VERB`, `COLLOCATION`, `IDIOM`, `PATTERN` (cấu trúc mẫu, ví dụ "be about to + V"), `EXPRESSION` (cụm cố định trong giao tiếp). Thêm giá trị mới bằng migration khi cần.
- **Chủ đề** (`topics`, text[], tối đa 3, như `travel`, `work`, `daily life`): tự mở rộng trong quá trình ôn, không có chuẩn cố định. Prompt cho Claude kèm danh sách chủ đề đang có để dùng lại, tránh `travel` và `trip` thành hai nhóm.
- Thống kê có thêm trục theo buổi học.

## 7. Thống kê nhóm khó và gợi ý liên kết

- **Nhóm khó**: một nhóm (loại, chủ đề hoặc buổi học) có từ 10 thẻ từng bị đánh Chưa nhớ. Đếm tích luỹ theo thẻ (`not_yet_count ≥ 1`): thẻ đã Chưa nhớ rồi sau đó Đã nhớ vẫn tính. Xếp hạng theo tỷ lệ = số thẻ từng Chưa nhớ / tổng thẻ của nhóm. Nhóm chưa đủ 10 thẻ như vậy thì chưa hiện; màn trống thì hiện "Chưa đủ dữ liệu".
- Các số tổng (lượt ôn, tỷ lệ Chưa nhớ, số thẻ lên `WEEKLY`) tính theo kỳ 7/30/90 ngày từ `study_card_reviews`. Thẻ hay quên: từ 3 lượt Chưa nhớ.
- Hàm thuần `study-card-insights`, có unit test.
- Tìm nguyên nhân và gợi ý nhóm liên quan do Claude làm ngoài app: nút "Sao chép cho Claude phân tích" tạo văn bản gồm số liệu, các thẻ hay quên kèm câu ví dụ và danh sách chủ đề đang có, yêu cầu (1) nhận xét nguyên nhân có thể (nhầm nghĩa gần nhau, cấu trúc ngữ pháp, chủ đề lạ...), (2) gợi ý 10–15 cụm liên quan, trả đúng định dạng JSON ở mục 5 để dán vào màn Nhập thẻ; cụm liên quan ghi trong `note` ("liên quan: ...").

## 8. Schema (migration kế tiếp là 0011 do `npm run db:generate` sinh; 0010 là `music_tracks`)

Mọi bảng có `user_id` (FK users, cascade); thêm các bảng mới vào `tablesFilter`.
- Enum `study_card_stage`, `study_card_rating` (`NOT_YET`, `REVIEW_AGAIN`, `REMEMBERED`), `study_card_kind` (5 giá trị), `study_card_bucket` (`DUE`, `NEW`, `HARD`, `RANDOM`), `study_log_activity`.
- `study_cards`: `id`, `subject_id` (FK `study_subjects`, cascade), `source_log_id` (FK `study_logs`, set null), `phrase` (≤ 255), `phrase_key`, `meaning`, `example`, `note`, `kind`, `topics` (text[]), `stage`, `due_at` (null khi NEW), `review_count`, `not_yet_count`, `last_reviewed_at`, `suspended`, `created_at`. Unique `(subject_id, phrase_key)`; index `(user_id, due_at)`.
- `study_card_reviews`: `id`, `card_id` (cascade), `reviewed_at`, `rating`, `bucket`, `stage_before`, `stage_after`, `due_after`. Index `(card_id, reviewed_at)`.
- `study_card_day_plan_items`: `id`, `subject_id` (cascade), `plan_date`, `card_id` (cascade), `bucket`. Unique `(subject_id, plan_date, card_id)`.
- `study_subjects` + `card_daily_quota` (int, mặc định 20; tối đa 20).
- `study_logs` + `activity` (mặc định `LESSON`).

## 9. API (dưới `/api/tra-dinh/hoc-tap`)

- `GET /cards?subjectId=&stage=&kind=&topic=&q=&limit=&cursor=`: kho thẻ kèm số đếm theo giai đoạn.
- `POST /cards` (một thẻ, 201); `GET/PATCH/DELETE /cards/[id]`. Đổi phrase trùng thì 409 `duplicate_phrase`.
- `POST /cards/parse` `{text}` → `{cards, errors, duplicates}` (không lưu). `POST /cards/import` `{subjectId, logId?, cards[]}` → `{created, skipped}`.
- `GET /cards/queue?subjectId=` → tạo hoặc bù kế hoạch ngày, trả danh sách thẻ trong kế hoạch (mỗi thẻ kèm `bucket`, `next`), số đã ôn và còn lại theo `bucket`, `quota`, `soonestDueAt` cho thẻ sắp quay lại trong ngày.
- `POST /cards/[id]/review` `{rating}` → thẻ sau khi cập nhật và số đếm; ghi `study_card_reviews` trong cùng transaction; thẻ `HARD`/`RANDOM` theo quy tắc ôn thêm ở mục 2.
- `GET /cards/insights?subjectId=&days=` (days = 7, 30 mặc định, hoặc 90; khác thì 400 `invalid_days`) → `{days, minCards: 10, totals, byKind, byTopic, byLesson, hardestCards}`. `totals` chỉ tính lượt ôn trong kỳ; các nhóm và `hardestCards` tính tích luỹ cả đời thẻ. Nhãn buổi học: "dd/MM · tên khóa", "dd/MM · Ôn tập" hoặc "dd/MM · Ôn thẻ".
- `GET /cards/topics?subjectId=` → `{topics: [{topic, cards}]}` (dùng cho prompt gửi Claude và chip lọc; tính cả thẻ tạm dừng).
- `POST /logs` nhận `activity` (`LESSON` | `CARD_REVIEW`); `CARD_REVIEW` mà có `courseId` hoặc `sections` thì 400. `GET /logs` trả `activity`.
- `GET /overview` thêm khối `cards: {planned, done, quota, nextReviewDay}`.
- Hàm thuần có unit test: `study-card-key`, `study-card-parse`, `study-card-schedule`, `study-card-queue`, `study-card-insights`.
- E2E: `scripts/study-cards-e2e.ts` (tự chặn production).

## 10. Flutter

- Route mới (khai báo trước `:sessionId`): `/tra-dinh/hoc-tap/the` (kho thẻ), `/the/on` (ôn), `/the/them` (nhập), `/the/thong-ke` (nhóm khó).
- Khối "Thẻ hôm nay: đã ôn N / 20" trên Tổng quan Trà Đình, bấm vào để bắt đầu ôn.
- Màn ôn: đếm "k / 20", chip số thẻ đến hạn / mới / ôn thêm, hết hàng đợi mà còn thẻ sắp quay lại thì hiện "N thẻ quay lại sau X phút".
- Hết phiên: màn Kết thúc phiên ôn với ô nhập số phút (artboard 6); "Bỏ qua" thì không tạo buổi học.
- Màu lấy từ theme (`ColorScheme`, `success`), không gắn trực tiếp token `AppColors` như các màn Trà Đình trước.
- Riverpod, go_router, dio; lỗi dùng helper lỗi chung. Ba nút đánh giá bị khoá trong lúc gọi API để tránh bấm đúp.
- Việc nhớ từ bước 5: (1) lịch và khối tổng quan đang hiện `courseTitle ?? 'Ôn tập'`, phải hiện "Ôn thẻ" theo `activity`; (2) bấm vào buổi `CARD_REVIEW` phải mở form riêng chỉ sửa số phút và ghi chú, không mở form buổi học bài; (3) thống kê `byCourse` có hai mục cùng `courseId` rỗng ("Ôn tập" và "Ôn thẻ"), nếu màn Flutter dùng `courseId` làm khoá thì phải đổi khoá.
- Hàng chip lọc phải cuộn ngang, không xuống dòng (lỗi cũ trên iPhone); mọi màn mới có nút quay lại.

## 11. Các bước (giao agent từng bước một)

| # | Bước | Repo | Trạng thái |
|---|---|---|---|
| 0 | Khảo sát: route, `tablesFilter`, `overview`, helper ngày giờ VN, mọi chỗ đọc `study_logs` (mục 4) | cả hai | xong 06/11 |
| 1 | Schema và migration, áp lên dev | backend | xong 06/11, 184ffcf |
| 2 | Hàm thuần và unit test (key, parse, schedule, queue, insights) | backend | xong 06/11, 7afdc38 (2a) + 45f7b2b (2b) |
| 3 | API kho thẻ: CRUD, parse, import | backend | xong 06/11, 51dbdd4 |
| 4 | API hàng ôn (kế hoạch ngày 20 thẻ), ghi lượt ôn, khối `cards` ở overview | backend | xong 06/11, 5dca30c |
| 5 | Buổi học `CARD_REVIEW` và chỉnh các hàm đọc `study_logs` | backend | xong 06/11, 9aa4eb6 |
| 6 | API insights và chủ đề | backend | xong 06/11, cd390ce |
| 7 | Flutter: kho thẻ, thêm/sửa thẻ, nhập thẻ | Flutter | xong 06/11, 776e60d |
| 8 | Flutter: ôn thẻ, kết thúc phiên và nhập phút, khối ở Tổng quan | Flutter | xong 06/11: 8a 6291dfe (ôn thẻ, kết thúc phiên), 8b 5dcb6ff (khối tổng quan, nhãn "Ôn thẻ", form buổi ôn thẻ, chọn buổi học, sửa khoá thống kê) |
| 9 | Flutter: thống kê nhóm khó và nút sao chép cho Claude (kèm sửa tràn hàng TodayCard) | Flutter | xong trên dev 06/11, chờ commit |
| 10 | Contract test với backend dev; người dùng thử tay trên dev | Flutter | |
| 11 | Production: kiểm tra `drizzle.__drizzle_migrations`, người dùng tạo nhánh Neon, migrate, deploy backend rồi Flutter, thử trên iPhone | cả hai | |
| 12 | Tổng kết vào `CLAUDE.md` | cả hai | |

## 12. Điều chỉnh sau nếu cần

- Phân bố 20 thẻ (thứ tự ưu tiên, tỷ lệ 70/20/10, đặt sàn thẻ mới mỗi ngày).
- Thẻ và lượt ôn là dữ liệu học tập trong `study_*`, chưa đẩy vào `agent_logs`; dữ liệu huấn luyện cho vai gia sư (`tutor`) bàn khi có speaking/writing.
- Bảng liên kết giữa các thẻ (`study_card_links`), đo thời gian trả lời mỗi thẻ, kéo-thả, loại thẻ nghe/phát âm.

## 13. Ràng buộc kỹ thuật

Giữ nguyên mục 7 của hai kế hoạch trước (`docs/nghi-su-duong-du-an-ke-hoach.md`, `docs/tra-dinh-hoc-tap-ke-hoach.md`, cần bản mới nhất) và `amber-v4/CLAUDE.md` (quy tắc deploy và DB). Cần nhớ:
- Quy ước backend: `withAuth`, zod, JSON trần, POST 201, DELETE `{ok:true}`, `db.transaction` khi ghi nhiều bảng.
- Agent không có credential GitHub, `neonctl` hay Neon; người dùng tự push, tự tạo nhánh Neon, tự thử giao diện.
- Push `main` của amber-v4 deploy mọi commit chưa push: kiểm tra `git log origin/main..main` trước.

## Phụ lục: prompt mẫu để Claude tạo thẻ từ transcript

```
Here is the transcript of my English lesson. Pick the 10–15 most useful
phrases (collocations, phrasal verbs, patterns), not single isolated words.
Return only a JSON array. Each item:
{"phrase", "meaning", "example", "note", "kind", "topics"}.
"meaning" is a simple English definition. "example" is a natural sentence
that contains the phrase. "note" is optional (grammar or usage warning).
"kind" is exactly one of: PHRASAL_VERB, COLLOCATION, IDIOM, PATTERN,
EXPRESSION. "topics" has up to 3 lowercase topics. Reuse these existing
topics when they fit: [LIST OF MY TOPICS].
```

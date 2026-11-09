DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "learn_course_details") OR EXISTS (SELECT 1 FROM "learn_lessons") OR EXISTS (SELECT 1 FROM "projects" WHERE "type" = 'LEARN') THEN
    RAISE EXCEPTION 'Học tập cũ còn dữ liệu (learn_course_details / learn_lessons / projects.type = LEARN): dừng migration 0014, xử lý dữ liệu trước';
  END IF;
END $$;--> statement-breakpoint
DROP TABLE "learn_course_details";--> statement-breakpoint
DROP TABLE "learn_lessons";

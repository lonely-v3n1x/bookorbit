CREATE TABLE "public_shelf_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "public_shelf_items" ADD CONSTRAINT "public_shelf_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_shelf_items" ADD CONSTRAINT "public_shelf_items_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "public_shelf_items_user_book_uidx" ON "public_shelf_items" USING btree ("user_id","book_id");--> statement-breakpoint
CREATE INDEX "public_shelf_items_user_position_idx" ON "public_shelf_items" USING btree ("user_id","position");
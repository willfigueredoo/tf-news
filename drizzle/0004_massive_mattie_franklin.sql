CREATE INDEX "news_published_idx" ON "news_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "news_primary_icp_published_idx" ON "news_items" USING btree ("primary_icp","published_at");--> statement-breakpoint
CREATE INDEX "news_source_published_idx" ON "news_items" USING btree ("source_id","published_at");--> statement-breakpoint
CREATE INDEX "news_status_published_idx" ON "news_items" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "news_archived_published_idx" ON "news_items" USING btree ("archived_at","published_at");--> statement-breakpoint
CREATE INDEX "news_updated_idx" ON "news_items" USING btree ("updated_at");
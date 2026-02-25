ALTER TABLE "hunted_individuals" RENAME TO "enriched_individuals";--> statement-breakpoint
ALTER TABLE "hunted_emails" RENAME TO "enriched_emails";--> statement-breakpoint
ALTER TABLE "enriched_individuals" RENAME COLUMN "hunted_at" TO "enriched_at";--> statement-breakpoint
ALTER TABLE "enriched_emails" RENAME COLUMN "hunted_at" TO "enriched_at";--> statement-breakpoint
ALTER TABLE "enriched_emails" RENAME CONSTRAINT "hunted_emails_email_hunted_at_pk" TO "enriched_emails_email_enriched_at_pk";--> statement-breakpoint
ALTER TABLE "enriched_individuals" RENAME CONSTRAINT "hunted_individuals_first_name_last_name_domain_hunted_at_pk" TO "enriched_individuals_first_name_last_name_domain_enriched_at_pk";--> statement-breakpoint
ALTER INDEX "idx_he_email" RENAME TO "idx_ee_email";--> statement-breakpoint
ALTER INDEX "idx_hi_domain" RENAME TO "idx_ei_domain";

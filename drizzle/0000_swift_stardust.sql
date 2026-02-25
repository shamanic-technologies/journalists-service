CREATE TYPE "public"."email_status" AS ENUM('valid', 'invalid', 'risky', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('individual', 'organization');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('Found online', 'Guessed from similar', 'Pure guess');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('valid', 'accept_all', 'unknown', 'invalid');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_outlet_journalists" (
	"campaign_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"journalist_id" uuid NOT NULL,
	"why_relevant" text NOT NULL,
	"why_not_relevant" text NOT NULL,
	"relevance_score" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_outlet_journalists_campaign_id_outlet_id_journalist_id_pk" PRIMARY KEY("campaign_id","outlet_id","journalist_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hunted_emails" (
	"email" text NOT NULL,
	"hunted_at" timestamp with time zone NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"accept_all" boolean DEFAULT false NOT NULL,
	"status" "email_status" NOT NULL,
	"regexp" boolean DEFAULT false NOT NULL,
	"gibberish" boolean DEFAULT false NOT NULL,
	"disposable" boolean DEFAULT false NOT NULL,
	"webmail" boolean DEFAULT false NOT NULL,
	"mx_records" boolean DEFAULT false NOT NULL,
	"smtp_server" boolean DEFAULT false NOT NULL,
	"smtp_check" boolean DEFAULT false NOT NULL,
	"block" boolean DEFAULT false NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hunted_emails_email_hunted_at_pk" PRIMARY KEY("email","hunted_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hunted_individuals" (
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"domain" text NOT NULL,
	"hunted_at" timestamp with time zone NOT NULL,
	"position" text,
	"twitter" text,
	"linkedin_url" text,
	"phone_number" text,
	"company" text,
	"sources" jsonb,
	"verification_date" date,
	"verification_status" "verification_status",
	"score" integer,
	"accept_all" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hunted_individuals_first_name_last_name_domain_hunted_at_pk" PRIMARY KEY("first_name","last_name","domain","hunted_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outlet_journalists" (
	"outlet_id" uuid NOT NULL,
	"journalist_id" uuid NOT NULL,
	CONSTRAINT "outlet_journalists_outlet_id_journalist_id_pk" PRIMARY KEY("outlet_id","journalist_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "press_journalists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"journalist_name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "searched_emails" (
	"outlet_id" uuid NOT NULL,
	"journalist_id" uuid NOT NULL,
	"searched_at" timestamp with time zone NOT NULL,
	"journalist_email" text NOT NULL,
	"source_status" "source_status",
	"source_quote" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "searched_emails_outlet_id_journalist_id_searched_at_pk" PRIMARY KEY("outlet_id","journalist_id","searched_at")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_outlet_journalists" ADD CONSTRAINT "campaign_outlet_journalists_journalist_id_press_journalists_id_fk" FOREIGN KEY ("journalist_id") REFERENCES "public"."press_journalists"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outlet_journalists" ADD CONSTRAINT "outlet_journalists_journalist_id_press_journalists_id_fk" FOREIGN KEY ("journalist_id") REFERENCES "public"."press_journalists"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "searched_emails" ADD CONSTRAINT "searched_emails_journalist_id_press_journalists_id_fk" FOREIGN KEY ("journalist_id") REFERENCES "public"."press_journalists"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coj_campaign" ON "campaign_outlet_journalists" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coj_outlet" ON "campaign_outlet_journalists" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_he_email" ON "hunted_emails" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hi_domain" ON "hunted_individuals" USING btree ("domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oj_journalist" ON "outlet_journalists" USING btree ("journalist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oj_outlet" ON "outlet_journalists" USING btree ("outlet_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_journalists_name_type" ON "press_journalists" USING btree ("journalist_name","entity_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_se_journalist" ON "searched_emails" USING btree ("journalist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_se_outlet" ON "searched_emails" USING btree ("outlet_id");
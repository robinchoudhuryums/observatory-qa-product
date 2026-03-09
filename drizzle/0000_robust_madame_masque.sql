CREATE TABLE "access_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"reason" text,
	"requested_role" varchar(20) DEFAULT 'viewer' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"reviewed_by" varchar(255),
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "call_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"call_id" text NOT NULL,
	"performance_score" varchar(20),
	"talk_time_ratio" varchar(20),
	"response_time" varchar(20),
	"keywords" jsonb,
	"topics" jsonb,
	"summary" text,
	"action_items" jsonb,
	"feedback" jsonb,
	"lemur_response" jsonb,
	"call_party_type" varchar(50),
	"flags" jsonb,
	"manual_edits" jsonb,
	"confidence_score" varchar(20),
	"confidence_factors" jsonb,
	"sub_scores" jsonb,
	"detected_agent_name" varchar(255),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"employee_id" text,
	"file_name" varchar(500),
	"file_path" text,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"duration" integer,
	"assembly_ai_id" varchar(255),
	"call_category" varchar(50),
	"tags" jsonb,
	"uploaded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "coaching_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"call_id" text,
	"assigned_by" varchar(255) NOT NULL,
	"category" varchar(50) DEFAULT 'general' NOT NULL,
	"title" varchar(500) NOT NULL,
	"notes" text,
	"action_plan" jsonb,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"due_date" timestamp,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(100),
	"initials" varchar(5),
	"status" varchar(20) DEFAULT 'Active',
	"sub_team" varchar(255),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"settings" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"call_category" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"evaluation_criteria" text NOT NULL,
	"required_phrases" jsonb,
	"scoring_weights" jsonb,
	"additional_instructions" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"updated_by" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "sentiment_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"call_id" text NOT NULL,
	"overall_sentiment" varchar(20),
	"overall_score" varchar(20),
	"segments" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"call_id" text NOT NULL,
	"text" text,
	"confidence" varchar(20),
	"words" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"quantity" real DEFAULT 1 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"username" varchar(100) NOT NULL,
	"password_hash" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" varchar(20) DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"last_login_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_analyses" ADD CONSTRAINT "call_analyses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_analyses" ADD CONSTRAINT "call_analyses_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_sessions" ADD CONSTRAINT "coaching_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_sessions" ADD CONSTRAINT "coaching_sessions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_sessions" ADD CONSTRAINT "coaching_sessions_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentiment_analyses" ADD CONSTRAINT "sentiment_analyses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentiment_analyses" ADD CONSTRAINT "sentiment_analyses_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_requests_org_id_idx" ON "access_requests" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "access_requests_status_idx" ON "access_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "analyses_call_id_idx" ON "call_analyses" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "analyses_org_id_idx" ON "call_analyses" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "analyses_performance_idx" ON "call_analyses" USING btree ("org_id","performance_score");--> statement-breakpoint
CREATE INDEX "calls_org_id_idx" ON "calls" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "calls_org_status_idx" ON "calls" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "calls_employee_id_idx" ON "calls" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "calls_uploaded_at_idx" ON "calls" USING btree ("uploaded_at");--> statement-breakpoint
CREATE INDEX "coaching_org_id_idx" ON "coaching_sessions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "coaching_employee_id_idx" ON "coaching_sessions" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "coaching_status_idx" ON "coaching_sessions" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "employees_org_id_idx" ON "employees" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_org_email_idx" ON "employees" USING btree ("org_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "prompt_templates_org_id_idx" ON "prompt_templates" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "prompt_templates_org_category_idx" ON "prompt_templates" USING btree ("org_id","call_category");--> statement-breakpoint
CREATE UNIQUE INDEX "sentiments_call_id_idx" ON "sentiment_analyses" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "sentiments_org_id_idx" ON "sentiment_analyses" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transcripts_call_id_idx" ON "transcripts" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "transcripts_org_id_idx" ON "transcripts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "usage_org_type_idx" ON "usage_events" USING btree ("org_id","event_type");--> statement-breakpoint
CREATE INDEX "usage_created_at_idx" ON "usage_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_idx" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "users_org_id_idx" ON "users" USING btree ("org_id");
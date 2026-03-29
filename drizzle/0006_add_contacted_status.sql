-- Add 'contacted' value to buffer_status enum (after 'served')
ALTER TYPE "public"."buffer_status" ADD VALUE IF NOT EXISTS 'contacted' AFTER 'served';

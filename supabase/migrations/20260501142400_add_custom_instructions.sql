-- Add custom_instructions column to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS custom_instructions TEXT;

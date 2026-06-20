-- Adding Gemini API Key and Model configuration columns to user_settings table
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS gemini_api_key text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS gemini_model text DEFAULT 'gemini-2.5-flash';

-- Enable users to delete their own accounts securely
-- This runs on the postgres system role (SECURITY DEFINER) to bypass client-side auth.users restrictions
CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS boolean AS $$
DECLARE
  current_user_id uuid;
BEGIN
  -- Get the current authenticated user's ID
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Explicitly delete user records from application tables
  DELETE FROM public.tasks WHERE user_id = current_user_id;
  DELETE FROM public.subjects WHERE user_id = current_user_id;
  DELETE FROM public.weekly_schedule WHERE user_id = current_user_id;
  DELETE FROM public.day_notes WHERE user_id = current_user_id;
  DELETE FROM public.slot_times WHERE user_id = current_user_id;
  DELETE FROM public.user_settings WHERE user_id = current_user_id;
  DELETE FROM public.student_profiles WHERE id = current_user_id;
  
  -- 2. Delete from auth.users (this deletes the user session and account)
  DELETE FROM auth.users WHERE id = current_user_id;
  
  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;

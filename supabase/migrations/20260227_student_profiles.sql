-- Create student_profiles table in Supabase
CREATE TABLE IF NOT EXISTS student_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'teacher')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE student_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'student_profiles' AND policyname = 'Public profiles are viewable by everyone'
  ) THEN
    CREATE POLICY "Public profiles are viewable by everyone"
      ON student_profiles
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'student_profiles' AND policyname = 'Users can insert/update their own profiles'
  ) THEN
    CREATE POLICY "Users can insert/update their own profiles"
      ON student_profiles
      FOR ALL
      TO authenticated
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);
  END IF;
END
$$;

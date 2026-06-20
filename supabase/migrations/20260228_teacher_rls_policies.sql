-- Row Level Security policies to allow teachers/doctors to manage student data
-- This permits teachers/doctors (role = 'teacher') to perform SELECT, INSERT, UPDATE, and DELETE on student subjects, tasks, and schedules.

DO $$
BEGIN
  -- 1. Row Level Security policies for subjects table
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'subjects' AND policyname = 'Teachers can manage all subjects'
  ) THEN
    CREATE POLICY "Teachers can manage all subjects"
      ON subjects FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM student_profiles WHERE id = auth.uid() AND role = 'teacher'))
      WITH CHECK (EXISTS (SELECT 1 FROM student_profiles WHERE id = auth.uid() AND role = 'teacher'));
  END IF;

  -- 2. Row Level Security policies for tasks table
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'tasks' AND policyname = 'Teachers can manage all tasks'
  ) THEN
    CREATE POLICY "Teachers can manage all tasks"
      ON tasks FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM student_profiles WHERE id = auth.uid() AND role = 'teacher'))
      WITH CHECK (EXISTS (SELECT 1 FROM student_profiles WHERE id = auth.uid() AND role = 'teacher'));
  END IF;

  -- 3. Row Level Security policies for weekly_schedule table
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'weekly_schedule' AND policyname = 'Teachers can manage all weekly schedules'
  ) THEN
    CREATE POLICY "Teachers can manage all weekly schedules"
      ON weekly_schedule FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM student_profiles WHERE id = auth.uid() AND role = 'teacher'))
      WITH CHECK (EXISTS (SELECT 1 FROM student_profiles WHERE id = auth.uid() AND role = 'teacher'));
  END IF;
END $$;

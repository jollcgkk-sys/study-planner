import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db, StudentProfile, Task, Subject, WeeklySchedule } from '../lib/db';
import { queueMutation } from '../lib/sync';
import { useSync } from '../contexts/SyncContext';
import { uuid } from '../lib/uuid';
import { useLiveQuery } from 'dexie-react-hooks';
import { supabase } from '../lib/supabase';
import { 
  GraduationCap, Users, PlusCircle, CheckCircle, Clock, Send, 
  History, UserPlus, AlertCircle, Trash2, Check, Star, BookOpen,
  X, Calendar, Plus, Zap
} from 'lucide-react';
import { WEEK_DAYS_UI_ORDER } from '../lib/weekDays';
import { motion, AnimatePresence } from 'motion/react';
import { pageTransition } from '../lib/motion';
import { cn } from '../lib/utils';
import { format, getISODay } from 'date-fns';
import { ar } from 'date-fns/locale';

const DEFAULT_STUDENTS: StudentProfile[] = [
  { id: 'student-demo-1', email: 'ahmed@student.edu', name: 'أحمد الرويلي', role: 'student', created_at: new Date().toISOString() },
  { id: 'student-demo-2', email: 'sara@student.edu', name: 'سارة يوسف', role: 'student', created_at: new Date().toISOString() },
  { id: 'student-demo-3', email: 'abdullah@student.edu', name: 'عبد الله الشهري', role: 'student', created_at: new Date().toISOString() },
  { id: 'student-demo-4', email: 'amal@student.edu', name: 'أمل الحربي', role: 'student', created_at: new Date().toISOString() }
];

export default function TeacherPortal() {
  const { user } = useAuth();
  const { triggerSync, isSyncing } = useSync();
  const [activeTab, setActiveTab] = useState<'students' | 'assign' | 'history'>('assign');
  const [toast, setToast] = useState<{ message: string; isError?: boolean } | null>(null);
  const [isSyncingProfiles, setIsSyncingProfiles] = useState(false);

  // Trigger data sync on mount to get the freshest student task states
  useEffect(() => {
    triggerSync();
  }, [triggerSync]);

  // Sync real-time registered student accounts from Supabase public student_profiles
  useEffect(() => {
    let active = true;
    const fetchRemoteProfiles = async () => {
      if (!navigator.onLine) return;
      setIsSyncingProfiles(true);
      try {
        const { data, error } = await supabase
          .from('student_profiles')
          .select('*')
          .eq('role', 'student');

        if (error) {
          console.warn('Failed to load remote student profiles from Supabase:', error);
          return;
        }

        if (data && data.length > 0 && active) {
          console.log(`Fetched ${data.length} registered student profiles from Supabase`);
          
          // Clear standard mock items if we have real registered users to keep clean
          const localCount = await db.student_profiles.count();
          // Filter and upsert each profile to local database
          for (const res of data) {
            await db.student_profiles.put({
              id: res.id,
              email: res.email,
              name: res.name,
              role: res.role,
              created_at: res.created_at || new Date().toISOString(),
              is_verified: true
            });
          }
        }
      } catch (err) {
        console.warn('Network exception while fetching registered student profiles:', err);
      } finally {
        if (active) {
          setIsSyncingProfiles(false);
        }
      }
    };

    fetchRemoteProfiles();
    return () => { active = false; };
  }, []);

  // Live query for student profiles
  const studentProfiles = useLiveQuery(async () => {
    const list = await db.student_profiles.toArray();
    // Prepopulate if empty and not syncing
    if (list.length === 0) {
      for (const std of DEFAULT_STUDENTS) {
        await db.student_profiles.put(std);
      }
      return DEFAULT_STUDENTS;
    }
    return list;
  }) || [];

  const uniqueStudentProfiles = useMemo(() => {
    const list = studentProfiles.filter(s => s.role === 'student');
    const map: Record<string, StudentProfile> = {};

    for (const student of list) {
      const existing = map[student.email];
      if (!existing) {
        map[student.email] = student;
      } else {
        const currentIsVerified = !!student.is_verified;
        const existingIsVerified = !!existing.is_verified;

        const currentIsDemo = student.id.startsWith('student-demo-');
        const existingIsDemo = existing.id.startsWith('student-demo-');

        let selectCurrent = false;

        if (currentIsVerified && !existingIsVerified) {
          selectCurrent = true;
        } else if (!currentIsVerified && existingIsVerified) {
          selectCurrent = false;
        } else {
          if (!currentIsDemo && existingIsDemo) {
            selectCurrent = true;
          }
        }

        if (selectCurrent) {
          map[student.email] = student;
        }
      }
    }
    return Object.values(map);
  }, [studentProfiles]);

  // Self-healing migration for manual student profiles that got registered on Supabase
  useEffect(() => {
    const migrateMergedStudents = async () => {
      if (studentProfiles.length === 0) return;

      // Group profiles by email
      const emailGroups: Record<string, StudentProfile[]> = {};
      for (const p of studentProfiles) {
        if (!p.email) continue;
        const email = p.email.toLowerCase();
        if (!emailGroups[email]) emailGroups[email] = [];
        emailGroups[email].push(p);
      }

      let migratedAny = false;

      for (const [email, profiles] of Object.entries(emailGroups)) {
        if (profiles.length < 2) continue;

        // Find the real/verified one
        const realProfile = profiles.find(p => p.is_verified && !p.id.startsWith('student-demo-'));
        // Find manual/unverified ones
        const oldProfiles = profiles.filter(p => p.id !== realProfile?.id);

        if (realProfile && oldProfiles.length > 0) {
          console.log(`[Auto-Migrate] Found registered student email "${email}" with real ID "${realProfile.id}" and old local duplicate IDs:`, oldProfiles.map(p => p.id));
          
          for (const old of oldProfiles) {
            const oldId = old.id;
            const newId = realProfile.id;

            // 1. Update local database records
            const localTasks = await db.tasks.where('user_id').equals(oldId).toArray();
            for (const t of localTasks) {
              await db.tasks.update(t.id, { user_id: newId });
            }

            const localSubjects = await db.subjects.where('user_id').equals(oldId).toArray();
            for (const s of localSubjects) {
              await db.subjects.update(s.id, { user_id: newId });
            }

            const localSchedules = await db.weekly_schedule.where('user_id').equals(oldId).toArray();
            for (const s of localSchedules) {
              await db.weekly_schedule.update(s.id, { user_id: newId });
            }

            const localSlotTimes = await db.slot_times.where('user_id').equals(oldId).toArray();
            for (const s of localSlotTimes) {
              await db.slot_times.update(s.id, { user_id: newId });
            }

            // 2. Update pending mutations (so there's no foreign key errors and they sync to the real user account)
            const mutations = await db.pending_mutations.toArray();
            for (const m of mutations) {
              if (m.user_id === oldId) {
                const updatedPayload = { ...m.payload };
                if (updatedPayload.user_id === oldId) {
                  updatedPayload.user_id = newId;
                }
                await db.pending_mutations.update(m.id, {
                  user_id: newId,
                  payload: updatedPayload,
                  status: 'pending' // Reset status to try uploading again to the right account!
                });
              }
            }

            // 3. Delete the old manual profile to prevent future duplicate matching
            await db.student_profiles.delete(oldId);
            console.log(`[Auto-Migrate] Successfully migrated and cleaned up duplicate manual profile for email "${email}"`);
            migratedAny = true;
          }
        }
      }

      if (migratedAny) {
        showToast('تم تحديث وتكامل حسابات واجبت الطلاب بنجاح مع الخادم');
        setTimeout(() => {
          triggerSync();
        }, 1000);
      }
    };

    migrateMergedStudents();
  }, [studentProfiles, triggerSync]);

  // Live query for tasks (to compute statistics)
  const allTasks = useLiveQuery(() => db.tasks.toArray()) || [];
  const allSubjects = useLiveQuery(() => db.subjects.toArray()) || [];
  const allWeeklySchedule = useLiveQuery(() => db.weekly_schedule.toArray()) || [];

  // --- Student Schedule Builder States ---
  const [selectedStudentForSchedule, setSelectedStudentForSchedule] = useState<StudentProfile | null>(null);
  const [scheduleSelectedDay, setScheduleSelectedDay] = useState<number>(6); // Default to Sunday (6 in WEEK_DAYS_UI_ORDER)
  const [newScheduleSubjectId, setNewScheduleSubjectId] = useState<string>('');
  
  // Custom new subject state for student
  const [showNewSubjectForm, setShowNewSubjectForm] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [newSubColor, setNewSubColor] = useState('#6366f1');
  const [isCreatingSub, setIsCreatingSub] = useState(false);

  // Manual student state
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentEmail, setNewStudentEmail] = useState('');
  const [isAddingStudent, setIsAddingStudent] = useState(false);

  // Assignment states
  const [assignMethod, setAssignMethod] = useState<'quick' | 'detailed'>('quick');
  const [quickTaskTitle, setQuickTaskTitle] = useState('');
  const [quickSubjectId, setQuickSubjectId] = useState('');
  const [quickCourseSubject, setQuickCourseSubject] = useState('');
  const [quickTargetType, setQuickTargetType] = useState<'all' | 'specific'>('all');
  const [quickSelectedStudentId, setQuickSelectedStudentId] = useState('');
  const [isQuickSubmitting, setIsQuickSubmitting] = useState(false);
  const [quickDueDate, setQuickDueDate] = useState('');

  const [targetType, setTargetType] = useState<'all' | 'specific'>('all');
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [taskType, setTaskType] = useState<'prep' | 'homework' | 'project'>('homework');
  const [courseSubject, setCourseSubject] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDetails, setTaskDetails] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isImportant, setIsImportant] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Show Toast controller
  const showToast = (message: string, isError = false) => {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 4000);
  };

  // Student Schedule Actions
  const handleAddScheduleSlot = async () => {
    if (!selectedStudentForSchedule) return;
    if (!newScheduleSubjectId) {
      showToast('⚠️ الرجاء اختيار المادة أولاً', true);
      return;
    }

    const daySlots = allWeeklySchedule
      .filter(s => s.user_id === selectedStudentForSchedule.id && Number(s.day_of_week) === Number(scheduleSelectedDay));
    
    const nextSlotIndex = daySlots.length > 0 ? Math.max(...daySlots.map(s => s.slot)) + 1 : 1;

    const newSlotItem: WeeklySchedule = {
      id: uuid(),
      user_id: selectedStudentForSchedule.id,
      day_of_week: Number(scheduleSelectedDay),
      slot: nextSlotIndex,
      subject_id: newScheduleSubjectId,
      start_time: '08:30', // Default start time
      end_time: '09:30'   // Default end time
    };

    try {
      await db.weekly_schedule.put(newSlotItem);
      await queueMutation('update_schedule', newSlotItem, selectedStudentForSchedule.id);
      showToast('تمت إضافة الحصة للجدول بنجاح!');
      setNewScheduleSubjectId('');
    } catch (err) {
      console.error(err);
      showToast('⚠️ فشل في إضافة الحصة للجدول', true);
    }
  };

  const handleDeleteScheduleSlot = async (slotId: string) => {
    if (!selectedStudentForSchedule) return;
    try {
      await db.weekly_schedule.delete(slotId);
      await queueMutation('delete_schedule', { id: slotId }, selectedStudentForSchedule.id);
      showToast('تم مسح الحصة من جدول الطالب');
    } catch (err) {
      console.error(err);
      showToast('⚠️ فشل في مسح الحصة', true);
    }
  };

  const handleUpdateSlotHours = async (slot: WeeklySchedule, field: 'start_time' | 'end_time', value: string) => {
    if (!selectedStudentForSchedule) return;
    try {
      const updatedSlot = { ...slot, [field]: value };
      await db.weekly_schedule.put(updatedSlot);
      await queueMutation('update_schedule', updatedSlot, selectedStudentForSchedule.id);
    } catch (err) {
      console.error('Failed to update slot hour:', err);
    }
  };

  const handleCreateStudentSubject = async () => {
    if (!selectedStudentForSchedule || !newSubName.trim()) {
      showToast('⚠️ يرجى كتابة اسم المادة أولاً', true);
      return;
    }
    setIsCreatingSub(true);
    try {
      const newSubItem: Subject = {
        id: uuid(),
        user_id: selectedStudentForSchedule.id,
        name: newSubName.trim(),
        color: newSubColor,
        created_at: new Date().toISOString()
      };
      await db.subjects.put(newSubItem);
      await queueMutation('create_subject', newSubItem, selectedStudentForSchedule.id);
      
      showToast(`تم إنشاء مادة "${newSubName.trim()}" بنجاح وتخصيصها للطالب!`);
      setNewScheduleSubjectId(newSubItem.id);
      setNewSubName('');
      setShowNewSubjectForm(false);
    } catch (err) {
      console.error(err);
      showToast('⚠️ تعذر إدخال المادة الجديدة', true);
    } finally {
      setIsCreatingSub(false);
    }
  };

  // Toggle student selection for targeted assignment
  const handleToggleStudentSelect = (studentId: string) => {
    setSelectedStudents(prev => 
      prev.includes(studentId) 
        ? prev.filter(id => id !== studentId) 
        : [...prev, studentId]
    );
  };

  // Add Student manually
  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudentName.trim() || !newStudentEmail.trim()) {
      showToast('الرجاء تعبئة جميع الحقول', true);
      return;
    }

    try {
      const newStd: StudentProfile = {
        id: uuid(),
        name: newStudentName.trim(),
        email: newStudentEmail.trim(),
        role: 'student',
        created_at: new Date().toISOString()
      };
      await db.student_profiles.put(newStd);
      showToast('تمت إضافة الطالب بنجاح إلى ملفات المدرس');
      setNewStudentName('');
      setNewStudentEmail('');
      setIsAddingStudent(false);
    } catch (err) {
      showToast('حدث خطأ أثناء إضافة البيانات', true);
    }
  };

  // Remove a custom student
  const handleDeleteStudent = async (id: string) => {
    try {
      await db.student_profiles.delete(id);
      showToast('تمت إزالة الطالب من السجل');
    } catch {
      showToast('حدث خطأ أثناء إزالة الطالب', true);
    }
  };

  // Send assignment (Task creator)
  const handleSendAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim() || !taskDetails.trim()) {
      showToast('يرجى كتابة عنوان للتكليف وتفاصيل المضمون البديل', true);
      return;
    }

    // Determine target recipient IDs
    const recipients = targetType === 'all' 
      ? uniqueStudentProfiles.map(s => s.id)
      : selectedStudents;

    if (recipients.length === 0) {
      showToast('يرجى تحديد طالب واحد على الأقل لإرسال التكليف له', true);
      return;
    }

    setIsSubmitting(true);
    try {
      const teacherName = user?.user_metadata?.name || user?.email || 'المعلم';
      // Prepend official teacher meta signature so student render views detect it beautifully!
      const teacherSignature = `👨‍🏫 تم إسناد هذا بواسطة الدكتور/المعلم: ${teacherName}\n\n${taskDetails}`;
      
      // Keep record of the subjects details
      let subId: string | null = null;
      if (selectedSubjectId) {
        subId = selectedSubjectId;
      }

      // Add task for each recipient
      for (const studentId of recipients) {
        // Create subject for the student if specific/custom text subject is typed and none chosen
        let targetStudentSubId = subId;
        if (courseSubject.trim() && !subId) {
          // See if subject already exists for student, otherwise generate one matching their workspace
          const existingStudSub = allSubjects.find(
            s => s.user_id === studentId && s.name.toLowerCase() === courseSubject.trim().toLowerCase()
          );
          if (existingStudSub) {
            targetStudentSubId = existingStudSub.id;
          } else {
            const newSub: Subject = {
              id: uuid(),
              user_id: studentId,
              name: courseSubject.trim(),
              color: '#4f46e5', // Brand Indigo
              created_at: new Date().toISOString()
            };
            await db.subjects.put(newSub);
            await queueMutation('create_subject', newSub, studentId).catch(() => {});
            targetStudentSubId = newSub.id;
          }
        }

        // Determine specific student due date (scheduled class date or selected, or tomorrow fallback)
        let resolvedDueDate = dueDate;
        if (!resolvedDueDate && targetStudentSubId) {
          const studentSchedule = allWeeklySchedule.filter(
            s => s.user_id === studentId && s.subject_id === targetStudentSubId
          );

          if (studentSchedule.length > 0) {
            let earliestDate: Date | null = null;
            const now = new Date();

            for (const slot of studentSchedule) {
              const dayOfWeek = slot.day_of_week;
              const targetDate = new Date();
              targetDate.setHours(8, 30, 0, 0); // stable default time for due date

              if (slot.start_time) {
                const [h, m] = slot.start_time.split(':').map(Number);
                if (!isNaN(h) && !isNaN(m)) {
                  targetDate.setHours(h, m, 0, 0);
                }
              }

              const currentDayNormalized = getISODay(now) - 1;
              let daysToAdd = (dayOfWeek - currentDayNormalized + 7) % 7;
              
              if (daysToAdd === 0) {
                daysToAdd = 7;
              }

              targetDate.setDate(targetDate.getDate() + daysToAdd);

              if (!earliestDate || targetDate < earliestDate) {
                earliestDate = targetDate;
              }
            }

            if (earliestDate) {
              resolvedDueDate = earliestDate.toISOString().split('T')[0];
            }
          }
        }

        // Final fallback if still empty (not scheduled)
        if (!resolvedDueDate) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          resolvedDueDate = tomorrow.toISOString().split('T')[0];
        }

        const newTask: Task = {
          id: uuid(),
          user_id: studentId,
          subject_id: targetStudentSubId || null,
          type: taskType,
          title: taskTitle.trim(),
          details: teacherSignature,
          due_at: resolvedDueDate,
          remind_at: null,
          is_done: false,
          is_important: isImportant,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        // Put locally in IndexedDB (Since local DB is shared in sandboxed preview browser,
        // students in other tabs instant-sync automatically and can interact with their tasks)
        await db.tasks.put(newTask);
        
        // Queue cloud-sync queue mutation to upload to remote database
        await queueMutation('create_task', newTask, studentId).catch(() => {});
      }

      showToast(`تم إرسال ونشر هذا التكليف بنجاح لعدد ${recipients.length} من الطلاب!`);
      
      // Reset assignment states
      setTaskTitle('');
      setTaskDetails('');
      setDueDate('');
      setCourseSubject('');
      setSelectedSubjectId('');
      setSelectedStudents([]);
      setIsImportant(false);
      setActiveTab('history'); // redirect to sent history
    } catch (err: any) {
      console.error(err);
      showToast('حدث خطأ أثناء رصد ونشر التكاليف', true);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quick Send submit handler with instant student synchronization
  const handleQuickSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTaskTitle.trim()) {
      showToast('⚠️ يرجى كتابة أو اختيار عنوان للواجب السريع', true);
      return;
    }

    // Determine target recipient IDs
    const recipients = quickTargetType === 'all'
      ? uniqueStudentProfiles.map(s => s.id)
      : (quickSelectedStudentId ? [quickSelectedStudentId] : []);

    if (recipients.length === 0) {
      showToast('⚠️ يرجى تحديد فئة المستلمين أو اختيار طالب لإرسال هذا الواجب', true);
      return;
    }

    setIsQuickSubmitting(true);
    try {
      const teacherName = user?.user_metadata?.name || user?.email || 'الدكتور/المهندس';
      // Put a distinct Quick Send prefix detail signature
      const teacherSignature = `👨‍🏫 تم إسناد هذا بواسطة الدكتور/المعلم: ${teacherName}\n\n📝 هذا واجب عاجل وسريع تم إرساله من لوحة التحكم الفورية.`;

      let subId: string | null = null;
      if (quickSubjectId) {
        subId = quickSubjectId;
      }

      for (const studentId of recipients) {
        let targetStudentSubId = subId;
        
        // If a new course name is typed in
        if (quickCourseSubject.trim() && !subId) {
          const existingStudSub = allSubjects.find(
            s => s.user_id === studentId && s.name.toLowerCase() === quickCourseSubject.trim().toLowerCase()
          );
          if (existingStudSub) {
            targetStudentSubId = existingStudSub.id;
          } else {
            const newSub: Subject = {
              id: uuid(),
              user_id: studentId,
              name: quickCourseSubject.trim(),
              color: '#4f46e5', // Brand Indigo
              created_at: new Date().toISOString()
            };
            await db.subjects.put(newSub);
            await queueMutation('create_subject', newSub, studentId).catch(() => {});
            targetStudentSubId = newSub.id;
          }
        }

        // Determine specific student due date (scheduled class date or selected, or tomorrow fallback)
        let resolvedDueDate = quickDueDate;
        if (!resolvedDueDate && targetStudentSubId) {
          const studentSchedule = allWeeklySchedule.filter(
            s => s.user_id === studentId && s.subject_id === targetStudentSubId
          );

          if (studentSchedule.length > 0) {
            let earliestDate: Date | null = null;
            const now = new Date();

            for (const slot of studentSchedule) {
              const dayOfWeek = slot.day_of_week;
              const targetDate = new Date();
              targetDate.setHours(8, 30, 0, 0); // stable default time for due date

              if (slot.start_time) {
                const [h, m] = slot.start_time.split(':').map(Number);
                if (!isNaN(h) && !isNaN(m)) {
                  targetDate.setHours(h, m, 0, 0);
                }
              }

              const currentDayNormalized = getISODay(now) - 1;
              let daysToAdd = (dayOfWeek - currentDayNormalized + 7) % 7;
              
              // If class is today, and the user sends it, make it due on the NEXT occurrence in 7 days
              if (daysToAdd === 0) {
                daysToAdd = 7;
              }

              targetDate.setDate(targetDate.getDate() + daysToAdd);

              if (!earliestDate || targetDate < earliestDate) {
                earliestDate = targetDate;
              }
            }

            if (earliestDate) {
              resolvedDueDate = earliestDate.toISOString().split('T')[0];
            }
          }
        }

        // Final fallback if still empty (not scheduled)
        if (!resolvedDueDate) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          resolvedDueDate = tomorrow.toISOString().split('T')[0];
        }

        const newTask: Task = {
          id: uuid(),
          user_id: studentId,
          subject_id: targetStudentSubId || null,
          type: 'homework',
          title: quickTaskTitle.trim(),
          details: teacherSignature,
          due_at: resolvedDueDate,
          remind_at: null,
          is_done: false,
          is_important: true, // Mark important by default for urgency
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        // Put locally in IndexedDB first
        await db.tasks.put(newTask);
        // Sync mutation upload
        await queueMutation('create_task', newTask, studentId).catch(() => {});
      }

      showToast(`⚡ تم إرسال الواجب السريع والتحضير بنجاح لعدد ${recipients.length} من الطلاب!`);

      // Reset Quick Homework fields
      setQuickTaskTitle('');
      setQuickCourseSubject('');
      setQuickSubjectId('');
      setQuickSelectedStudentId('');
      setQuickDueDate('');

      // Trigger automatic sync down the wire
      triggerSync();

      // View results list
      setActiveTab('history');
    } catch (err: any) {
      console.error('Quick homework submit exception:', err);
      showToast('حدث خطأ أثناء رصد الواجب السريع', true);
    } finally {
      setIsQuickSubmitting(false);
    }
  };

  // Sent History loader (Filters tasks from IndexedDB that contains the Teacher signature prefix)
  const sentAssignmentsLog = allTasks.filter(t => t.details && t.details.includes('👨‍🏫 تم إسناد هذا بواسطة'));

  // Delete sent assignment for all students
  const handleDeleteSentAssignment = async (title: string, date: string) => {
    try {
      // Find all tasks representing this broadcast assignment
      const tasksToDel = allTasks.filter(t => t.title === title && t.created_at.substring(0, 16) === date.substring(0, 16));
      for (const t of tasksToDel) {
        await db.tasks.delete(t.id);
        await queueMutation('delete_task', { id: t.id, user_id: t.user_id }, t.user_id).catch(() => {});
      }
      showToast('تم حذف وإلغاء التكليف لجميع الطلاب بنجاح');
    } catch {
      showToast('حدث خطأ أثناء محاولة إلغاء التكليف', true);
    }
  };

  return (
    <motion.div 
      className="space-y-6 max-w-4xl mx-auto pb-12"
      initial="initial"
      animate="animate"
      exit="exit"
      variants={pageTransition}
    >
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={cn(
              "fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl px-4 py-3 text-white shadow-lg",
              toast.isError ? "bg-red-600" : "bg-emerald-600"
            )}
          >
            <AlertCircle className="h-5 w-5" />
            <span className="font-medium text-sm">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hero Welcome banner */}
      <div className="rounded-2xl border border-[var(--border)] bg-gradient-to-r from-[var(--primary)]/10 to-[var(--primary)]/5 p-6 md:p-8 theme-transition flex flex-col md:flex-row items-center gap-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--primary)] text-white shadow-md shadow-[var(--primary)]/20 animate-pulse">
          <GraduationCap className="h-9 w-9" />
        </div>
        <div className="text-center md:text-right space-y-2 flex-1">
          <h2 className="text-2xl font-bold text-[var(--text)]">بوابة المدرس والدكتور الجامعي</h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            مرحباً بك يا دكتور. تمنحك هذه الواجهة السيطرة الكاملة على مساقاتك العلمية؛ قم بإلقاء نظرة على حسابات طلابك ومستوياتهم، وجهز دفاتر التحضير اليومية، وأسند الواجبات للفصل بأكمله أو اختر نخبة مخصصة من الطلاب.
          </p>
        </div>
      </div>

      {/* Primary tabs */}
      <div className="flex border-b border-[var(--border)] gap-2 scrollbar-none overflow-x-auto">
        <button
          onClick={() => setActiveTab('assign')}
          className={cn(
            "flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all whitespace-nowrap",
            activeTab === 'assign'
              ? "border-[var(--primary)] text-[var(--primary)]"
              : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
          )}
        >
          <PlusCircle className="h-4 w-4" />
          إسناد واجب وتحضير جديد
        </button>
        <button
          onClick={() => setActiveTab('students')}
          className={cn(
            "flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all whitespace-nowrap",
            activeTab === 'students'
              ? "border-[var(--primary)] text-[var(--primary)]"
              : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
          )}
        >
          <Users className="h-4 w-4" />
          حسابات الطلاب ({uniqueStudentProfiles.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={cn(
            "flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all whitespace-nowrap",
            activeTab === 'history'
              ? "border-[var(--primary)] text-[var(--primary)]"
              : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
          )}
        >
          <History className="h-4 w-4" />
          الأعمال والتحاضير المرسلة ({Array.from(new Set(sentAssignmentsLog.map(t => t.title + t.created_at.substring(0,16)))).length})
        </button>
      </div>

      {/* Main Tab content rendering */}
      <div className="theme-transition">
        {activeTab === 'assign' && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm space-y-6">
            {/* Header with dual modes */}
            <div className="flex items-center justify-between border-b border-[var(--border)]/70 pb-4 flex-wrap gap-4">
              <h3 className="text-lg font-bold text-[var(--text)] flex items-center gap-2">
                <PlusCircle className="h-5 w-5 text-[var(--primary)]" />
                تكوين وإسناد عمل دراسي جديد
              </h3>
              
              <div className="flex bg-[var(--surface)] p-1 rounded-xl border border-[var(--border)] gap-1">
                <button
                  type="button"
                  onClick={() => setAssignMethod('quick')}
                  className={cn(
                    "px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                    assignMethod === 'quick'
                      ? "bg-[var(--card)] text-[var(--primary)] shadow-xs border border-[var(--border)]/75"
                      : "text-[var(--muted)] hover:text-[var(--text)]"
                  )}
                >
                  ⚡ واجب سريع
                </button>
                <button
                  type="button"
                  onClick={() => setAssignMethod('detailed')}
                  className={cn(
                    "px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                    assignMethod === 'detailed'
                      ? "bg-[var(--card)] text-[var(--primary)] shadow-xs border border-[var(--border)]/75"
                      : "text-[var(--muted)] hover:text-[var(--text)]"
                  )}
                >
                  📋 تكليف تفصيلي
                </button>
              </div>
            </div>

            {assignMethod === 'quick' ? (
              /* --- Quick Send Form --- */
              <form onSubmit={handleQuickSend} className="space-y-6">
                {/* Suggestions pill group */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--muted)] block">💡 الأفكار والاقتراحات الجاهزة للواجب السريع (اضغط للاختيار):</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {[
                      '📖 حل الواجب والتمارين لدرس اليوم',
                      '✏️ كتابة وتجهيز الأنشطة التطبيقية للكتاب',
                      '🔍 تحضير قراءة الفصل الجديد للحصة القادمة',
                      '💡 تلخيص الدرس ومراجعته جيداً وكتابة الملاحظات',
                      '🧪 مراجعة القوانين وحل مسائل مسودة التدريب'
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setQuickTaskTitle(suggestion)}
                        className={cn(
                          "px-3 py-2.5 rounded-xl text-xs font-bold text-right border transition-all cursor-pointer hover:bg-[var(--primary)]/5 duration-150 shadow-2xs leading-relaxed break-words",
                          quickTaskTitle === suggestion
                            ? "border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)]"
                            : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--muted)]"
                        )}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Task Title */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-[var(--text)] block">عنوان الواجب السريع</label>
                  <input
                    type="text"
                    required
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:border-[var(--primary)] focus:outline-none"
                    placeholder="مثال: كتابة تدريبات وحلول درس اليوم"
                    value={quickTaskTitle}
                    onChange={(e) => setQuickTaskTitle(e.target.value)}
                  />
                </div>

                {/* Subject dropdown & custom input cleanly separated to prevent overflow */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-[var(--text)] block">المادة الدراسية (المساق)</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[var(--surface)]/30 p-4 rounded-xl border border-[var(--border)]/70">
                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold text-[var(--muted)] block">📦 اختر من المواد المتاحة:</span>
                      <select
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none"
                        value={quickSubjectId}
                        onChange={(e) => {
                          setQuickSubjectId(e.target.value);
                          if (e.target.value) setQuickCourseSubject('');
                        }}
                      >
                        <option value="">-- مادة مسجلة --</option>
                        {Array.from(new Set(allSubjects.map(s => s.name))).map(name => {
                          const orig = allSubjects.find(s => s.name === name);
                          return <option key={orig?.id} value={orig?.id}>{name}</option>;
                        })}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold text-[var(--muted)] block">✍️ أو اكتب اسم مادة جديدة:</span>
                      <input
                        type="text"
                        disabled={!!quickSubjectId}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:border-[var(--primary)] focus:outline-none disabled:opacity-40"
                        placeholder="مثال: علم البيئة للثانوية"
                        value={quickCourseSubject}
                        onChange={(e) => setQuickCourseSubject(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Recipients layout options with all and single options made fully responsive */}
                <div className="space-y-3">
                  <label className="text-sm font-semibold text-[var(--text)] block">الطلاب المستهدفون للواجب</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
                    <button
                      type="button"
                      onClick={() => setQuickTargetType('all')}
                      className={cn(
                        "p-4 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition-all text-xs font-bold cursor-pointer text-center shadow-2xs",
                        quickTargetType === 'all'
                          ? "border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)] ring-2 ring-[var(--primary)]/10"
                          : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--muted)]"
                      )}
                    >
                      <span className="text-sm">📢 جميع الطلاب</span>
                      <span className="text-[10px] font-normal text-[var(--muted)]">إسناد لجميع الطلاب المقيدين للفصل</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickTargetType('specific')}
                      className={cn(
                        "p-4 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition-all text-xs font-bold cursor-pointer text-center shadow-2xs",
                        quickTargetType === 'specific'
                          ? "border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)] ring-2 ring-[var(--primary)]/10"
                          : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--muted)]"
                      )}
                    >
                      <span className="text-sm">🎯 طالب معين</span>
                      <span className="text-[10px] font-normal text-[var(--muted)]">اختيار طالب مستقل محدد</span>
                    </button>
                  </div>

                  {/* Student selector dropdown */}
                  {quickTargetType === 'specific' && (
                    <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] space-y-2 mt-2 animate-fadeIn">
                      <label className="text-xs font-bold text-[var(--text)] block">اختر الطالب المستلم للواجب:</label>
                      <select
                        required={quickTargetType === 'specific'}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none"
                        value={quickSelectedStudentId}
                        onChange={(e) => setQuickSelectedStudentId(e.target.value)}
                      >
                        <option value="">-- اضغط هنا لتحديد اسم الطالب --</option>
                        {uniqueStudentProfiles.map(student => (
                          <option key={student.id} value={student.id}>
                            {student.name} ({student.email})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Due Date for Quick Assignment */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-[var(--text)] block">🕰️ موعد التسليم أو تاريخ الاستحقاق (اختياري)</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none"
                    value={quickDueDate}
                    onChange={(e) => setQuickDueDate(e.target.value)}
                  />
                  <p className="text-xs text-[var(--muted)]">💡 إذا تركت هذا فارغاً، فسيتم تحديد موعد التسليم تلقائياً ليكون في تاريخ المحاضرة/الحصة القادمة المجدولة للطلب لهذه المادة، أو غداً كخيار بديل إذا لم تكن مجدولة في جدول الطالب.</p>
                </div>

                {/* Send Button */}
                <button
                  type="submit"
                  disabled={isQuickSubmitting}
                  className="w-full bg-[var(--primary)] text-white hover:bg-[var(--primary)]/95 flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 active:scale-[0.99] disabled:opacity-50 cursor-pointer text-sm"
                >
                  <Zap className="h-4 w-4 fill-current text-yellow-350" />
                  {isQuickSubmitting ? 'جاري إرسال ونشر الواجب السريع...' : 'إرسال ونشر الواجب السريع الآن ⚡'}
                </button>
              </form>
            ) : (
              /* --- Detailed Create Form --- */
              <form onSubmit={handleSendAssignment} className="space-y-6">
                {/* Recipient scope selection */}
                <div className="space-y-3">
                  <label className="text-sm font-semibold text-[var(--text)] block">تخصيص الفئة المستهدفة</label>
                  <div className="grid grid-cols-2 gap-3 max-w-md">
                    <button
                      type="button"
                      onClick={() => setTargetType('all')}
                      className={cn(
                        "p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all text-sm font-medium",
                        targetType === 'all'
                          ? "border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)]"
                          : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]"
                      )}
                    >
                      <span className="text-lg">📢 الجميع</span>
                      عموم طلاب الفصل الدراسي
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetType('specific')}
                      className={cn(
                        "p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all text-sm font-medium",
                        targetType === 'specific'
                          ? "border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)]"
                          : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]"
                      )}
                    >
                      <span className="text-lg">🎯 طلاب محددين</span>
                      اختيار يدوي مخصص للطلاب
                    </button>
                  </div>

                  {/* Selected Students checklist */}
                  {targetType === 'specific' && (
                    <div className="mt-3 p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] space-y-3">
                      <span className="text-xs font-semibold text-[var(--muted)] block">حدد الطلاب المستلمين:</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {uniqueStudentProfiles.map(student => (
                          <button
                            key={student.id}
                            type="button"
                            onClick={() => handleToggleStudentSelect(student.id)}
                            className={cn(
                              "flex items-center justify-between p-2.5 rounded-lg border text-right transition-all",
                              selectedStudents.includes(student.id)
                                ? "border-[var(--primary)] bg-[var(--card)] text-[var(--primary)] shadow-sm"
                                : "border-[var(--border)] bg-[var(--card)] text-[var(--text)]"
                            )}
                          >
                            <div className="flex flex-col">
                              <span className="text-sm font-semibold">{student.name}</span>
                              <span className="text-[10px] text-[var(--muted)]" dir="ltr">{student.email}</span>
                            </div>
                            <div className={cn(
                              "w-5 h-5 rounded-full border flex items-center justify-center transition-all",
                              selectedStudents.includes(student.id) ? "bg-[var(--primary)] border-[var(--primary)] text-white" : "border-[var(--border)]"
                            )}>
                              {selectedStudents.includes(student.id) && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Assignment type selector */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-[var(--text)] block">نوع التكليف الأكاديمي</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'homework', label: '📝 واجب منزلي', desc: 'تكليف الطلاب بمهام وحل أسئلة' },
                      { id: 'prep', label: '📚 تحضير درس', desc: 'تجهيز قراءة أو تحضير للدرس القادم' },
                      { id: 'project', label: '🧬 مشروع بحثي', desc: 'مشروع أو مراجعة بحثية أكاديمية' }
                    ].map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setTaskType(item.id as any)}
                        className={cn(
                          "p-3 rounded-lg border flex flex-col gap-1 text-right transition-all text-xs font-bold",
                          taskType === item.id
                            ? "border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)]"
                            : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:text-[var(--text)]"
                        )}
                      >
                        <span>{item.label}</span>
                        <span className="font-normal opacity-80 hidden sm:block">{item.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Subject selector */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-[var(--text)] block">المادة الدراسية (المساق)</label>
                    {allSubjects.length > 0 ? (
                      <select
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none"
                        value={selectedSubjectId}
                        onChange={(e) => {
                          setSelectedSubjectId(e.target.value);
                          if (e.target.value) setCourseSubject('');
                        }}
                      >
                        <option value="">-- اختر من المواد المتاحة --</option>
                        {/* Get unique subject names */}
                        {Array.from(new Set(allSubjects.map(s => s.name))).map(name => {
                          const orig = allSubjects.find(s => s.name === name);
                          return <option key={orig?.id} value={orig?.id}>{name}</option>;
                        })}
                      </select>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--muted)]">أو اكتب اسم مادة دراسية جديدة:</span>
                      <input
                        type="text"
                        disabled={!!selectedSubjectId}
                        className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:border-[var(--primary)] focus:outline-none disabled:opacity-50"
                        placeholder="مثال: علم الأحياء د. خالد"
                        value={courseSubject}
                        onChange={(e) => setCourseSubject(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Due Date & Importance */}
                  <div className="grid grid-cols-2 gap-3 pt-6">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-[var(--muted)] block">تاريخ التسليم النهائي (اختياري)</label>
                      <input
                        type="date"
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                      />
                      <span className="text-[10px] text-[var(--muted)] leading-tight block">💡 يترك فارغاً للتحديد التلقائي المناسب للحصة القادمة بجدول الطالب.</span>
                    </div>
                    <div className="flex flex-col justify-end p-2 border border-[var(--border)] rounded-lg bg-[var(--surface)]">
                      <label className="relative inline-flex items-center justify-between cursor-pointer w-full">
                        <span className="text-xs font-semibold text-[var(--text)]">مهم للغاية ⭐</span>
                        <input 
                          type="checkbox" 
                          className="sr-only peer" 
                          checked={isImportant}
                          onChange={(e) => setIsImportant(e.target.checked)}
                        />
                        <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--primary)]"></div>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Title & Details */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-[var(--text)] block">عنوان التكليف أو الواجب</label>
                    <input
                      type="text"
                      required
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:border-[var(--primary)] focus:outline-none"
                      placeholder="مثال: إكمال مسائل الوحدة الرابعة"
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-[var(--text)] block">تفاصيل العمل والشرح</label>
                    <textarea
                      rows={4}
                      required
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:border-[var(--primary)] focus:outline-none"
                      placeholder="اكتب التوجيهات بالتفصيل، الأقسام المطلوب حلها، أو توجيهات تحضير الدرجات الأكاديمية والتقارير المطلوبة..."
                      value={taskDetails}
                      onChange={(e) => setTaskDetails(e.target.value)}
                    />
                  </div>
                </div>

                {/* Action buttons */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-[var(--primary)] text-white hover:bg-[var(--primary)]/95 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 active:scale-[0.99] disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {isSubmitting ? 'جاري نشر التكاليف للطلاب...' : 'نشر وإرسال التكليف للفصل'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Student Accounts Sub-portal */}
        {activeTab === 'students' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--text)] flex items-center gap-2">
                <Users className="h-5 w-5 text-[var(--primary)]" />
                سجل الطلاب ومتابعة الأداء
              </h3>
              <button
                onClick={() => setIsAddingStudent(!isAddingStudent)}
                className="bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-white rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
              >
                <UserPlus className="h-4 w-4" />
                إضافة طالب مخصص
              </button>
            </div>

            {/* Adding Student Form */}
            {isAddingStudent && (
              <motion.form 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                onSubmit={handleAddStudent}
                className="p-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] space-y-4 shadow-inner"
              >
                <span className="text-sm font-semibold text-[var(--text)] block">تخصيص طالب جديد بالفصل الدراسي</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    placeholder="اسم الطالب الكامل"
                    className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--text)] focus:border-[var(--primary)] focus:outline-none"
                    value={newStudentName}
                    onChange={(e) => setNewStudentName(e.target.value)}
                  />
                  <input
                    type="email"
                    required
                    placeholder="البريد الإلكتروني للجامعة/المدرسة"
                    className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--text)] focus:border-[var(--primary)] focus:outline-none"
                    value={newStudentEmail}
                    onChange={(e) => setNewStudentEmail(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-2 text-xs">
                  <button 
                    type="button" 
                    onClick={() => setIsAddingStudent(false)}
                    className="bg-[var(--surface)] text-[var(--text)] px-3 py-2 rounded-lg border border-[var(--border)]"
                  >
                    إلغاء
                  </button>
                  <button 
                    type="submit" 
                    className="bg-[var(--primary)] text-white px-3 py-2 rounded-lg"
                  >
                    حفظ البيانات
                  </button>
                </div>
              </motion.form>
            )}

            {/* Student list grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {uniqueStudentProfiles.map((student) => {
                const studentTasks = allTasks.filter(t => t.user_id === student.id);
                const doneTasks = studentTasks.filter(t => t.is_done);
                const outstandingPrepsCount = studentTasks.filter(t => t.type === 'prep' && !t.is_done).length;
                const outstandingHomeworksCount = studentTasks.filter(t => t.type === 'homework' && !t.is_done).length;

                return (
                  <div 
                    key={student.id}
                    className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 flex flex-col justify-between shadow-sm hover:shadow-md transition-all relative group"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <span className="text-sm font-bold text-[var(--text)] block mb-1">{student.name}</span>
                        <span className="text-xs text-[var(--muted)] block" dir="ltr">{student.email}</span>
                        {student.id.startsWith('student-demo-') ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)] border border-[var(--border)] mt-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted)]"></span>
                            طالب تجريبي افتراضي
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 mt-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                            حساب مسجل حقيقي بسيرفر Supabase
                          </span>
                        )}
                      </div>
                      
                      {/* Delete option for custom student */}
                      {student.id.startsWith('student-demo') ? null : (
                        <button
                          onClick={() => handleDeleteStudent(student.id)}
                          className="text-red-500 hover:text-red-600 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {/* Progress tracking */}
                    <div className="mt-4 pt-4 border-t border-[var(--border)] space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--muted)]">نسبة إنجاز تكاليف المدرس:</span>
                        <span className="font-bold text-[var(--text)]">
                          {studentTasks.length > 0 
                            ? `${doneTasks.length} / ${studentTasks.length} (${Math.round((doneTasks.length / studentTasks.length) * 100)}%)` 
                            : 'لا توجد تكاليف مسندة حالياً'}
                        </span>
                      </div>
                      {studentTasks.length > 0 && (
                        <div className="w-full bg-[var(--surface)] h-2 rounded-full overflow-hidden">
                          <div 
                            className="bg-[var(--primary)] h-full rounded-full transition-all duration-500"
                            style={{ width: `${(doneTasks.length / studentTasks.length) * 100}%` }}
                          />
                        </div>
                      )}
                      
                      <div className="flex gap-2 pt-2 text-[10px] font-semibold text-[var(--muted)]">
                        {outstandingHomeworksCount > 0 && (
                          <span className="bg-amber-50 border border-amber-200 text-amber-700 px-1.5 py-0.5 rounded-md">
                            {outstandingHomeworksCount} واجب معلق
                          </span>
                        )}
                        {outstandingPrepsCount > 0 && (
                          <span className="bg-indigo-50 border border-indigo-200 text-indigo-700 px-1.5 py-0.5 rounded-md">
                            {outstandingPrepsCount} تحضير معلق
                          </span>
                        )}
                        {studentTasks.length === 0 && (
                          <span className="bg-gray-50 border border-gray-200 text-gray-500 px-1.5 py-0.5 rounded-md">
                            جاهز لتلقي الواجبات
                          </span>
                        )}
                      </div>

                      {/* Edit Schedule Button */}
                      <button
                        onClick={() => {
                          setSelectedStudentForSchedule(student);
                          setShowNewSubjectForm(false);
                          setNewScheduleSubjectId('');
                        }}
                        className="w-full flex items-center justify-center gap-2 mt-3 cursor-pointer rounded-xl border border-[var(--primary)] bg-[var(--primary)]/5 hover:bg-[var(--primary)]/10 px-3 py-2 text-xs font-bold text-[var(--primary)] transition-colors theme-transition"
                      >
                        <Calendar className="h-3.5 w-3.5" />
                        <span>تعديل جدول الطالب الدراسي</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Sent history logs */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <h3 className="text-lg font-bold text-[var(--text)] flex items-center gap-2">
                <History className="h-5 w-5 text-[var(--primary)]" />
                أرشيف الأعمال الصادرة والتحاضير
              </h3>
              <button
                type="button"
                onClick={() => triggerSync({ force: true })}
                disabled={isSyncing}
                className="flex items-center gap-2 text-xs font-bold text-[var(--primary)] hover:bg-[var(--primary)]/5 px-3 py-2 rounded-xl border border-[var(--primary)]/25 transition-all cursor-pointer disabled:opacity-50"
              >
                <span className={isSyncing ? "animate-spin inline-block" : "inline-block"}>🔄</span>
                {isSyncing ? 'جاري التحديث...' : 'تحديث حالة الحل الآن'}
              </button>
            </div>

            {sentAssignmentsLog.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] p-12 text-center text-[var(--muted)]">
                <AlertCircle className="h-10 w-10 mx-auto text-[var(--muted)] mb-3 opacity-60" />
                لم تقم بإرسال أي تكاليف أو تحاضير للطلاب حتى الآن. اذهب إلى تبويب وضع تكليف جديد للبدء.
              </div>
            ) : (
              <div className="space-y-4">
                {/* Group tasks by title & creation date to represent a single broadcast action */}
                {(() => {
                  const groups: Record<string, {
                    title: string;
                    details: string;
                    type: string;
                    created_at: string;
                    due_at: string | null;
                    is_important: boolean;
                    recipientsCount: number;
                    completedCount: number;
                    tasks: Task[];
                  }> = {};

                  sentAssignmentsLog.forEach(t => {
                    const groupKey = t.title + t.created_at.substring(0, 16);
                    if (!groups[groupKey]) {
                      groups[groupKey] = {
                        title: t.title,
                        details: t.details.replace(/👨‍🏫 تم إسناد هذا بواسطة الدكتور\/المعلم: .*\n\n/, ''), // strip teacher badge
                        type: t.type,
                        created_at: t.created_at,
                        due_at: t.due_at || null,
                        is_important: t.is_important,
                        recipientsCount: 0,
                        completedCount: 0,
                        tasks: []
                      };
                    }
                    groups[groupKey].recipientsCount += 1;
                    if (t.is_done) {
                      groups[groupKey].completedCount += 1;
                    }
                    groups[groupKey].tasks.push(t);
                  });

                  return Object.values(groups).map((group, idx) => {
                    const formattedDate = format(new Date(group.created_at), 'yyyy-MM-dd hh:mm a', { locale: ar });
                    
                    const typeLabels = {
                      prep: '📘 تحضير درس',
                      homework: '📝 واجب منزلي',
                      project: '🧬 مشروع أكاديمي'
                    };

                    return (
                      <div 
                        key={idx}
                        className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4 shadow-sm hover:shadow-md transition-all theme-transition"
                      >
                        <div className="flex items-start justify-between flex-wrap gap-2">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold rounded bg-[var(--surface)] px-2.5 py-1 text-[var(--primary)] border border-[var(--border)]">
                                {typeLabels[group.type as keyof typeof typeLabels] || group.type}
                              </span>
                              {group.is_important && (
                                <span className="bg-red-50 text-red-600 border border-red-200 rounded px-2 py-0.5 text-[10px] font-bold flex items-center gap-1">
                                  <Star className="h-3 w-3 fill-red-500" /> عاجل ومهم
                                </span>
                              )}
                            </div>
                            <h4 className="text-base font-bold text-[var(--text)] pt-1">{group.title}</h4>
                            <span className="text-xs text-[var(--muted)] block">تاريخ الإرسال: {formattedDate}</span>
                          </div>

                          <div className="flex gap-2">
                            {/* Recall / delete broadcast */}
                            <button
                              onClick={() => handleDeleteSentAssignment(group.title, group.created_at)}
                              className="text-red-600 hover:bg-red-50 bg-red-50/20 px-3 py-1.5 rounded-lg border border-red-100 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm hover:shadow active:scale-95 duration-150"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              إلغاء التكليف للجميع
                            </button>
                          </div>
                        </div>

                        <p className="text-sm text-[var(--text-secondary)] bg-[var(--surface)] p-3 rounded-lg border border-[var(--border)] whitespace-pre-line break-words max-h-32 overflow-y-auto">
                          {group.details}
                        </p>

                        {/* Recipient Details & Status Breakdown */}
                        <div className="bg-[var(--surface)]/30 p-4 rounded-xl border border-[var(--border)]/70 space-y-3">
                          <div className="flex items-center justify-between text-xs font-bold text-[var(--text)] border-b border-[var(--border)]/75 pb-2">
                            <span className="flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5 text-[var(--primary)]" />
                              الطلاب المستلمون وحالة إنجاز الواجب والمادة:
                            </span>
                            <span className="text-[var(--primary)] font-medium">إجمالي المستلمون: {group.tasks.length}</span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                            {group.tasks.map((taskInstance) => {
                              const student = studentProfiles.find(s => s.id === taskInstance.user_id);
                              const subject = allSubjects.find(s => s.id === taskInstance.subject_id);
                              
                              const studentName = student?.name || 'طالب مجهول أو مسترجع';
                              const studentEmail = student?.email || '';
                              const subjectName = subject?.name || 'مادة عامّة';
                              const subjectColor = subject?.color || '#6366f1';

                              return (
                                <div 
                                  key={taskInstance.id}
                                  className={cn(
                                    "flex items-center justify-between p-2.5 rounded-lg border text-xs transition-all duration-150",
                                    taskInstance.is_done 
                                      ? "border-emerald-200/50 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300"
                                      : "border-[var(--border)] bg-[var(--card)] text-[var(--text)]"
                                  )}
                                >
                                  <div className="flex flex-col gap-0.5 max-w-[55%]">
                                    <span className="font-bold truncate">{studentName}</span>
                                    {studentEmail && (
                                      <span className="text-[10px] text-[var(--muted)] font-mono truncate">{studentEmail}</span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {/* Subject badge */}
                                    <span 
                                      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold text-white shadow-xs max-w-[80px] truncate"
                                      style={{ backgroundColor: subjectColor }}
                                    >
                                      {subjectName}
                                    </span>

                                    {/* Completion status */}
                                    {taskInstance.is_done ? (
                                      <span className="bg-emerald-100 dark:bg-emerald-950/85 px-1.5 py-0.5 rounded font-bold text-[10px] flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400">
                                        ✓ مُنجز
                                      </span>
                                    ) : (
                                      <span className="bg-amber-50 dark:bg-amber-950/50 px-1.5 py-0.5 rounded font-bold text-[10px] flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                                        ⏳ قيد العمل
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="flex justify-between items-center text-xs pt-2 border-t border-[var(--border)]">
                          <div className="flex items-center gap-2 text-[var(--muted)]">
                            <Users className="h-4 w-4" />
                            <span>المستلمون: <b>{group.recipientsCount}</b> طلاب</span>
                          </div>
                          
                          <div className="flex items-center gap-1">
                            <span className="font-semibold text-[var(--muted)]">نسبة حل الواجب:</span>
                            <span className={cn(
                              "font-bold px-2 py-0.5 rounded-full",
                              group.completedCount === group.recipientsCount 
                                ? "bg-emerald-100 text-emerald-800" 
                                : "bg-blue-100 text-blue-800"
                            )}>
                              {group.completedCount} / {group.recipientsCount} ({Math.round((group.completedCount / group.recipientsCount) * 100)}%)
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Student Schedule Manager Modal */}
      <AnimatePresence>
        {selectedStudentForSchedule && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-4xl rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto theme-transition"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-4 animate-in slide-in-from-top duration-200">
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-[var(--text)] flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-[var(--primary)]" />
                    تحديد جدول الطالب الأسبوعي
                  </h3>
                  <p className="text-xs text-[var(--muted)]">
                    الطالب: <strong className="text-[var(--text)]">{selectedStudentForSchedule.name}</strong> ({selectedStudentForSchedule.email})
                  </p>
                </div>
                <button
                  onClick={() => setSelectedStudentForSchedule(null)}
                  className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)] transition-colors cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Day selection tabs */}
              <div className="flex gap-1.5 overflow-x-auto pb-2 border-b border-[var(--border)] scrollbar-thin">
                {WEEK_DAYS_UI_ORDER.map(day => {
                  const isDaySelected = Number(scheduleSelectedDay) === Number(day.id);
                  const daySlotsCount = allWeeklySchedule.filter(
                    s => s.user_id === selectedStudentForSchedule.id && Number(s.day_of_week) === Number(day.id)
                  ).length;

                  return (
                    <button
                      key={day.id}
                      type="button"
                      onClick={() => {
                        setScheduleSelectedDay(day.id);
                        setShowNewSubjectForm(false);
                      }}
                      className={cn(
                        "px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer",
                        isDaySelected
                          ? "bg-[var(--primary)] text-white shadow-sm"
                          : "bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)]"
                      )}
                    >
                      <span>{day.label}</span>
                      {daySlotsCount > 0 && (
                        <span className={cn(
                          "px-1.5 py-0.5 rounded-full text-[10px]",
                          isDaySelected ? "bg-white text-[var(--primary)]" : "bg-[var(--border)] text-[var(--text)]"
                        )}>
                          {daySlotsCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Active Slots list */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-[var(--text)]">
                    حصص ومواعيد يوم ({WEEK_DAYS_UI_ORDER.find(d => d.id === scheduleSelectedDay)?.label || ''})
                  </h4>
                  <span className="text-xs text-[var(--muted)] select-none">ساعات الحصص تحفظ وتتم مزامنتها تلقائياً عند تغيير الحقول</span>
                </div>

                {(() => {
                  const daySlots = allWeeklySchedule
                    .filter(s => s.user_id === selectedStudentForSchedule.id && Number(s.day_of_week) === Number(scheduleSelectedDay))
                    .sort((a, b) => {
                      if (a.start_time && b.start_time) {
                        return a.start_time.localeCompare(b.start_time);
                      }
                      return a.slot - b.slot;
                    });

                  if (daySlots.length === 0) {
                    return (
                      <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-[var(--muted)] bg-[var(--surface)]/40 animate-in fade-in duration-200">
                        <Clock className="h-8 w-8 mx-auto text-[var(--muted)] mb-2 opacity-50" />
                        <p className="text-xs font-semibold">لا توجد حصص مجدولة للطالب في هذا اليوم حالياً.</p>
                        <p className="text-[11px] text-[var(--muted)]/80 mt-1">يمكنك البدء بإضافة الحصة الأولى من النموذج بالأسفل لملء الفراغ.</p>
                      </div>
                    );
                  }

                  return (
                    <div className="grid gap-3 sm:grid-cols-2 animate-in fade-in duration-200">
                      {daySlots.map(slot => {
                        const subject = allSubjects.find(s => s.id === slot.subject_id);
                        return (
                          <div
                            key={slot.id}
                            className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm hover:shadow-md transition-all relative group"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span
                                  className="h-3 w-3 rounded-full"
                                  style={{ backgroundColor: subject?.color || '#ccc' }}
                                />
                                <span className="text-xs font-bold text-[var(--text)]">{subject?.name || 'مادة محذوفة'}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleDeleteScheduleSlot(slot.id)}
                                className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 p-1.5 rounded-lg transition-colors cursor-pointer"
                                title="حذف الحصة"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>

                            {/* Timing Selectors */}
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="space-y-1">
                                <label className="text-[10px] text-[var(--muted)] block font-medium">الوقـت من:</label>
                                <input
                                  type="time"
                                  value={slot.start_time || '08:00'}
                                  onChange={(e) => handleUpdateSlotHours(slot, 'start_time', e.target.value)}
                                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] text-[var(--muted)] block font-medium">الوقـت إلى:</label>
                                <input
                                  type="time"
                                  value={slot.end_time || '09:00'}
                                  onChange={(e) => handleUpdateSlotHours(slot, 'end_time', e.target.value)}
                                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Form to append slots */}
              <div className="mt-4 pt-4 border-t border-[var(--border)] space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-[var(--text)] flex items-center gap-1.5">
                    <Plus className="h-4 w-4 text-[var(--primary)]" />
                    إضافة حصة جديدة لجدول الطالب
                  </h4>
                  <button
                    type="button"
                    onClick={() => setShowNewSubjectForm(!showNewSubjectForm)}
                    className="text-xs font-bold text-[var(--primary)] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {showNewSubjectForm ? '× إلغاء إنشاء مادة' : '+ إنشاء مادة جديدة وتخصيصها للطالب'}
                  </button>
                </div>

                {showNewSubjectForm ? (
                  <div className="p-4 rounded-xl border border-dashed border-[var(--primary)]/30 bg-[var(--primary)]/[0.02] space-y-3 animate-in fade-in duration-300">
                    <h5 className="text-xs font-bold text-[var(--text)]">إنشاء مادة وتخصيصها للطالب</h5>
                    <div className="grid gap-3 sm:grid-cols-3 items-end">
                      <div className="space-y-1 sm:col-span-2">
                        <label className="text-[10px] sm:text-xs text-[var(--muted)] block font-semibold text-[var(--text)]">اسم المادة الدراسية الجديدة:</label>
                        <input
                          type="text"
                          placeholder="مثال: لغة إنجليزية مستوى 2، تقنيات ويب"
                          value={newSubName}
                          onChange={(e) => setNewSubName(e.target.value)}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--primary)] font-semibold"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] sm:text-xs text-[var(--muted)] block font-semibold text-[var(--text)] font-semibold">لون التمييز:</label>
                        <div className="flex gap-2 items-center">
                          <input
                            type="color"
                            value={newSubColor}
                            onChange={(e) => setNewSubColor(e.target.value)}
                            className="h-8 w-12 cursor-pointer rounded border border-[var(--border)] p-1 bg-transparent"
                          />
                          <button
                            type="button"
                            onClick={handleCreateStudentSubject}
                            disabled={isCreatingSub}
                            className="flex-1 bg-[var(--primary)] text-white text-xs font-bold py-2 px-3 rounded-lg hover:bg-[var(--primary)]/90 disabled:opacity-50 transition-colors cursor-pointer"
                          >
                            {isCreatingSub ? 'جاري الإنشاء...' : 'حفظ المادة'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-4 items-end animate-in fade-in duration-200">
                    <div className="space-y-1 sm:col-span-3">
                      <label className="text-xs font-semibold text-[var(--text)] block mb-1">اختر مادة الطالب الدراسية:</label>
                      {allSubjects.filter(sub => sub.user_id === selectedStudentForSchedule?.id).length === 0 ? (
                        <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-900/30 p-2.5 rounded-lg font-bold leading-relaxed">
                          ⚠️ ليس لدى هذا الطالب أي مواد مسجلة بعد. يرجى الضغط على "+ إنشاء مادة جديدة وتخصيصها للطالب" بالأعلى لتتمكن من إضافة حصص دراسية لجدوله.
                        </div>
                      ) : (
                        <select
                          value={newScheduleSubjectId}
                          onChange={(e) => setNewScheduleSubjectId(e.target.value)}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--text)] focus:border-[var(--primary)] focus:outline-none font-semibold cursor-pointer"
                        >
                          <option value="">-- اختر مادة من القائمة لجدولتها --</option>
                          {allSubjects
                            .filter(sub => sub.user_id === selectedStudentForSchedule?.id)
                            .map(sub => (
                              <option key={sub.id} value={sub.id}>
                                {sub.name}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                    <div>
                      <button
                        type="button"
                        onClick={handleAddScheduleSlot}
                        disabled={!newScheduleSubjectId}
                        className="w-full bg-[var(--primary)] text-white text-xs font-bold py-2.5 px-4 rounded-xl hover:bg-[var(--primary)]/90 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="h-4 w-4" />
                        <span>إضافة الحصة للجدول</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Close Button Footer */}
              <div className="border-t border-[var(--border)] pt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedStudentForSchedule(null)}
                  className="bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-xl py-2 px-5 text-xs font-bold hover:bg-[var(--border)] transition-colors cursor-pointer"
                >
                  إغلاق نافذة الجدول
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

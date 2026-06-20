import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { LogOut, User as UserIcon, Clock, Save, Lock, Bell, Palette, Activity, GraduationCap, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db, SlotTime, ThemeKey } from '../lib/db';
import { queueMutation } from '../lib/sync';
import { useLiveQuery } from 'dexie-react-hooks';
import { uuid } from '../lib/uuid';
import { cn } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import { motion } from 'motion/react';
import { pageTransition } from '../lib/motion';
import NotificationHelpDialog from '../components/NotificationHelpDialog';

const THEMES: { id: ThemeKey; name: string; previewClass: string }[] = [
  { id: 'default', name: 'افتراضي', previewClass: 'bg-[var(--surface)] border-[var(--border)]' },
  { id: 'cats_night', name: 'قطط ليلية', previewClass: 'bg-[var(--primary)] border-[var(--primary)]' },
  { id: 'pink_cute', name: 'زهري', previewClass: 'bg-pink-100 border-pink-400' },
  { id: 'sandy_cat', name: 'رملي', previewClass: 'bg-amber-100 border-amber-400' },
];

export default function Settings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { theme, setTheme, reduceMotion, setReduceMotion } = useTheme();

  const slotTimes = useLiveQuery(() => db.slot_times.where('user_id').equals(user?.id || '').toArray(), [user?.id]) || [];
  const userSettings = useLiveQuery(() => db.user_settings.get(user?.id || ''), [user?.id]);
  
  const [slotsCount, setSlotsCount] = useState(6);
  const [localSlots, setLocalSlots] = useState<Record<number, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [toast, setToast] = useState<{ id: string, message: string, isError?: boolean } | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [currentRole, setCurrentRole] = useState<'student' | 'teacher'>(user?.user_metadata?.role || 'student');
  const [isSavingRole, setIsSavingRole] = useState(false);
  const [showTeacherPasswordPrompt, setShowTeacherPasswordPrompt] = useState(false);
  const [teacherPassword, setTeacherPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [userNameInput, setUserNameInput] = useState(user?.user_metadata?.name || '');
  const [isSavingName, setIsSavingName] = useState(false);

  // Account deletion states
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmationWord, setDeleteConfirmationWord] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  useEffect(() => {
    if (user?.user_metadata?.role) {
      setCurrentRole(user.user_metadata.role);
    }
  }, [user]);

  useEffect(() => {
    if (user?.user_metadata?.name) {
      setUserNameInput(user.user_metadata.name);
    }
  }, [user]);

  const handleUpdateName = async () => {
    if (!user) return;
    const finalName = userNameInput.trim();
    if (!finalName) {
      showToast('⚠️ يرجى إدخال اسمك أولاً.', true);
      return;
    }

    if (currentRole === 'student') {
      const parts = finalName.split(/\s+/).filter(Boolean);
      if (parts.length < 3) {
        showToast('⚠️ يرجى إدخال اسمك الثلاثي الحقيقي الحقيقي (الاسم الأول واسم الأب واسم الجد/العائلة) ليسهل على الدكتور أو المعلم العثور على حسابك.', true);
        return;
      }
    }

    setIsSavingName(true);
    try {
      // 1. Update User metadata in Supabase auth
      const { error: authError } = await supabase.auth.updateUser({
        data: { name: finalName }
      });
      if (authError) throw authError;

      // 2. Update student_profiles table in Supabase
      const { error: remoteError } = await supabase.from('student_profiles').upsert({
        id: user.id,
        email: user.email || '',
        name: finalName,
        role: currentRole,
        created_at: new Date().toISOString()
      });
      if (remoteError) throw remoteError;

      // 3. Update local Dexie DB profile
      await db.student_profiles.put({
        id: user.id,
        email: user.email || '',
        name: finalName,
        role: currentRole,
        created_at: new Date().toISOString()
      });

      showToast('تم تحديث اسمك الشخصي بنجاح ومزامنته مع كشوفات المعلمين!');
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحديث الاسم الشخصي', true);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleToggleRole = async (newRole: 'student' | 'teacher') => {
    if (!user) return;
    setIsSavingRole(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { role: newRole }
      });
      if (error) throw error;
      
      const profileName = user.user_metadata?.name || user.email?.split('@')[0] || 'مستفيد';

      // Update in Supabase student_profiles table
      const { error: remoteError } = await supabase.from('student_profiles').upsert({
        id: user.id,
        email: user.email || '',
        name: profileName,
        role: newRole,
        created_at: new Date().toISOString()
      });

      if (remoteError) {
        console.error('Failed to sync updated profile to Supabase during role toggle:', remoteError);
      }
      
      // Update in local student_profiles too
      await db.student_profiles.put({
        id: user.id,
        email: user.email || '',
        name: profileName,
        role: newRole,
        created_at: new Date().toISOString()
      });
      
      setCurrentRole(newRole);
      showToast('تم تحديث دورك التعليمي بنجاح! سيتم تنشيط بوابتك المخصصة.');
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحديث الدور التعليمي', true);
    } finally {
      setIsSavingRole(false);
    }
  };

  const handleConfirmTeacherUpgrade = async () => {
    if (teacherPassword !== 'A07830395151a@') {
      setPasswordError('⚠️ كلمة سر غير صحيحة! يرجى التأكد وإعادة المحاولة.');
      return;
    }
    setPasswordError('');
    setShowTeacherPasswordPrompt(false);
    setTeacherPassword('');
    await handleToggleRole('teacher');
  };

  useEffect(() => {
    if (!isInitialized && (userSettings !== undefined || slotTimes.length > 0)) {
      if (userSettings) {
        setSlotsCount(userSettings.slot_count);
      } else if (slotTimes.length > 0) {
        const maxSlot = Math.max(...slotTimes.map(s => s.slot));
        setSlotsCount(Math.max(6, maxSlot));
      }
      
      const newLocalSlots: Record<number, string> = {
        1: '08:30', 2: '10:30', 3: '12:30', 4: '14:30', 5: '16:30', 6: '18:30'
      };
      if (slotTimes.length > 0) {
        slotTimes.forEach(s => {
          newLocalSlots[s.slot] = s.start_time;
        });
      }
      setLocalSlots(newLocalSlots);
      setIsInitialized(true);
    }
  }, [slotTimes, userSettings, isInitialized]);

  const showToast = (message: string, isError = false) => {
    setToast({ id: uuid(), message, isError });
    setTimeout(() => setToast(null), 5000);
  };

  const handleLogout = async () => {
    try {
      if (user) {
        // Clear local data for this user to prevent leakage
        const userId = user.id;
        await Promise.all([
          db.subjects.where('user_id').equals(userId).delete(),
          db.tasks.where('user_id').equals(userId).delete(),
          db.weekly_schedule.where('user_id').equals(userId).delete(),
          db.day_notes.where('user_id').equals(userId).delete(),
          db.slot_times.where('user_id').equals(userId).delete(),
          db.user_settings.where('user_id').equals(userId).delete(),
          db.pending_mutations.where('user_id').equals(userId).delete()
        ]);
      }
    } catch (err) {
      console.error('Error clearing local data on logout:', err);
    }
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Network error during sign out:', err);
    }
    navigate('/login');
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    if (deleteConfirmationWord.trim() !== 'حذف') {
      showToast('⚠️ يرجى كتابة كلمة "حذف" للتأكيد بشكل صحيح.', true);
      return;
    }

    setIsDeletingAccount(true);
    try {
      const userId = user.id;

      // 1. Try to call the RPC function configured in Supabase
      const { error: rpcError } = await supabase.rpc('delete_user_account');
      
      if (rpcError) {
        console.warn('RPC deletion failed or function is missing, attempting manual public profile delete:', rpcError);
        try {
          // Fallback to direct client delete of profile
          await supabase.from('student_profiles').delete().eq('id', userId);
        } catch (e) {
          console.warn('Could not delete remote student profile manually:', e);
        }
      }

      // 2. Erase everything from Local Dexie Database
      await Promise.all([
        db.subjects.where('user_id').equals(userId).delete(),
        db.tasks.where('user_id').equals(userId).delete(),
        db.weekly_schedule.where('user_id').equals(userId).delete(),
        db.day_notes.where('user_id').equals(userId).delete(),
        db.slot_times.where('user_id').equals(userId).delete(),
        db.user_settings.where('user_id').equals(userId).delete(),
        db.pending_mutations.where('user_id').equals(userId).delete(),
        db.student_profiles.where('id').equals(userId).delete()
      ]);

      // 3. Clear auth session offline
      await supabase.auth.signOut();
      
      // 4. Reset & Redirect
      setShowDeleteConfirm(false);
      setDeleteConfirmationWord('');
      
      showToast('تم حذف الحساب وكافة البيانات بشكل نهائي.');
      setTimeout(() => {
        navigate('/login');
      }, 1000);
    } catch (err: any) {
      console.error('Account deletion error:', err);
      showToast(err?.message || 'حدث خطأ أثناء حذف الحساب', true);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleTimeChange = (slot: number, time: string) => {
    setLocalSlots(prev => ({ ...prev, [slot]: time }));
  };

  const handleSaveSlots = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      // Save user settings (slot count)
      await queueMutation('upsert_user_settings', {
        user_id: user.id,
        slot_count: slotsCount,
        updated_at: new Date().toISOString()
      }, user.id);

      // Save individual slot times
      for (let i = 1; i <= slotsCount; i++) {
        const time = localSlots[i] || '08:00';
        const existing = slotTimes.find(s => s.slot === i);
        
        if (existing) {
          if (existing.start_time !== time) {
            await queueMutation('update_slot_time', { ...existing, start_time: time, updated_at: new Date().toISOString() }, user.id);
          }
        } else {
          const newSlot: SlotTime = {
            id: uuid(),
            user_id: user.id,
            slot: i,
            start_time: time,
            updated_at: new Date().toISOString()
          };
          await queueMutation('update_slot_time', newSlot, user.id);
        }
      }

      // Delete extra slots if count was reduced
      await queueMutation('delete_slot_times_after', {
        user_id: user.id,
        slot_count: slotsCount
      }, user.id);

      showToast('تم حفظ الإعدادات بنجاح');
    } catch (error) {
      showToast('حدث خطأ أثناء حفظ الإعدادات', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      showToast('كلمة المرور يجب أن تكون 8 أحرف على الأقل', true);
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('كلمتا المرور غير متطابقتين', true);
      return;
    }

    setIsChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      
      showToast('تم تحديث كلمة المرور بنجاح');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      console.error('Error changing password:', error);
      showToast(error.message || 'حدث خطأ أثناء تحديث كلمة المرور', true);
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <motion.div 
      className="space-y-6 max-w-2xl mx-auto relative"
      initial="initial"
      animate="animate"
      exit="exit"
      variants={pageTransition}
    >
      {/* Toast Notification */}
      {toast && (
        <div className={cn(
          "fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl px-4 py-3 text-white shadow-lg animate-in slide-in-from-top-4 fade-in duration-300",
          toast.isError ? "bg-red-600" : "bg-emerald-600"
        )}>
          <Bell className="h-5 w-5" />
          <span className="font-medium text-sm">{toast.message}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[var(--text)]">الإعدادات</h2>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm space-y-6 theme-transition">
        <div className="flex items-center gap-4 border-b border-[var(--border)] pb-6 theme-transition">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">
            <UserIcon className="h-8 w-8" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[var(--text)]">الحساب</h3>
            <p className="text-sm text-[var(--muted)]" dir="ltr">{user?.email}</p>
          </div>
        </div>

        {/* User Profile Information (Real triple name) */}
        <div className="space-y-4 pt-2 border-b border-[var(--border)] pb-6 theme-transition">
          <h4 className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
            <UserIcon className="h-4 w-4 text-[var(--muted)]" />
            الاسم الشخصي المعتمد في كشوفات الجامعة / المدرسة
          </h4>
          <p className="text-xs text-[var(--muted)] font-medium leading-relaxed">
            {currentRole === 'student' 
              ? '📢 يجب إدخال اسمك الثلاثي الحقيقي (الاسم الأول، واسم الأب، وباقي اللقب العائلي) لتسهيل تمييز حسابك ومن أعمالك المرسلة لدى الدكتور أو المدرس.'
              : 'الاسم الكامل واللقب العلمي الخاص بك والذي سيظهر للطلاب مع كافة التحاضير والتكاليف الدراسية.'}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 max-w-md">
            <input
              type="text"
              placeholder={currentRole === 'student' ? "أدخل اسمك الثلاثي الحقيقي..." : "أدخل اسمك الكامل اللقب العلمي..."}
              value={userNameInput}
              onChange={(e) => setUserNameInput(e.target.value)}
              className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none"
            />
            <button
              onClick={handleUpdateName}
              disabled={isSavingName}
              className="bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 text-xs px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 theme-transition cursor-pointer"
            >
              <Save className="h-3.5 w-3.5" />
              {isSavingName ? 'جاري الحفظ...' : 'حفظ الاسم'}
            </button>
          </div>
        </div>

        {/* Academic Role Selection Settings */}
        <div className="space-y-4 pt-2 border-b border-[var(--border)] pb-6 theme-transition">
          <h4 className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-[var(--muted)]" />
            الدور التعليمي / المسار الدراسي الحالي
          </h4>
          <p className="text-xs text-[var(--muted)]">
            يمكنك التغيير فوراً لتفعيل بوابة المدرس (لوضع التحاضير والمهام ومتابعة أداء الطلاب) أو بوابة الطالب للتعلم والتخطيط اليومي المتوازن.
          </p>
          <div className="grid grid-cols-2 gap-3 max-w-sm">
            <button
              onClick={() => {
                if (currentRole === 'student') return;
                setShowTeacherPasswordPrompt(false);
                handleToggleRole('student');
              }}
              disabled={isSavingRole}
              className={cn(
                "p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all text-xs font-semibold disabled:opacity-50",
                currentRole === 'student'
                  ? "border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]"
              )}
            >
              <span>👨‍🎓 حساب طالب</span>
            </button>
            <button
              onClick={() => {
                if (currentRole === 'teacher') return;
                setShowTeacherPasswordPrompt(true);
                setPasswordError('');
                setTeacherPassword('');
              }}
              disabled={isSavingRole}
              className={cn(
                "p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all text-xs font-semibold disabled:opacity-50",
                currentRole === 'teacher'
                  ? "border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]"
              )}
            >
              <span>👨‍🏫 حساب دكتور / مدرس</span>
            </button>
          </div>

          {showTeacherPasswordPrompt && (
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-500/5 space-y-3 max-w-sm animate-in fade-in duration-300">
              <label className="text-xs font-bold text-amber-600 block">⚠️ رمز تفعيل وضع الدكتور أو المعلم المعتمد:</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={teacherPassword}
                  onChange={(e) => setTeacherPassword(e.target.value)}
                  placeholder="أدخل كلمة السر هنا..."
                  className="flex-1 rounded-lg border border-amber-300 bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--text)] focus:border-[var(--primary)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleConfirmTeacherUpgrade}
                  className="bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 text-xs px-4 py-1.5 rounded-lg font-semibold"
                >
                  تأكيد
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowTeacherPasswordPrompt(false);
                    setTeacherPassword('');
                    setPasswordError('');
                  }}
                  className="bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--text)] text-xs px-3 py-1.5 rounded-lg"
                >
                  إلغاء
                </button>
              </div>
              {passwordError && <p className="text-[10px] text-red-500 font-bold">{passwordError}</p>}
            </div>
          )}
        </div>

        {/* Theme Settings */}
        <div className="space-y-4 pt-2 border-b border-[var(--border)] pb-6 theme-transition">
          <h4 className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
            <Palette className="h-4 w-4 text-[var(--muted)]" />
            المظهر / الثيم
          </h4>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={cn(
                  "flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all",
                  theme === t.id 
                    ? "border-[var(--primary)] bg-[var(--primary)]/5" 
                    : "border-transparent hover:border-[var(--border)] bg-[var(--bg)]"
                )}
              >
                <div className={cn("w-full h-12 rounded-lg border", t.previewClass)} />
                <span className="text-xs font-medium text-[var(--text)]">{t.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Accessibility Settings */}
        <div className="space-y-4 pt-2 border-b border-[var(--border)] pb-6 theme-transition">
          <h4 className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
            <Activity className="h-4 w-4 text-[var(--muted)]" />
            إمكانية الوصول
          </h4>
          
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--text)]">تقليل الحركة</p>
              <p className="text-xs text-[var(--muted)]">إيقاف التأثيرات الحركية والانتقالات</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer" 
                checked={reduceMotion}
                onChange={(e) => setReduceMotion(e.target.checked)}
              />
              <div className="w-11 h-6 bg-[var(--surface)] peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[var(--primary)]/20 rounded-full peer peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-[var(--card)] after:border-[var(--border)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--primary)]"></div>
            </label>
          </div>
        </div>

        {/* Notifications & Telephone Alerts Settings */}
        <div className="space-y-4 pt-2 border-b border-[var(--border)] pb-6 theme-transition">
          <h4 className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
            <Bell className="h-4 w-4 text-[var(--muted)]" />
            إشعارات الهاتف وتنبيهات المتصفح
          </h4>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 space-y-4">
            <p className="text-xs leading-relaxed text-[var(--muted)]">
              تساعدك الإشعارات الأصلية على تلقي تذكيرات وتنبيهات فورية بالواجبات، المهام المنزلية، والتحاضير مباشرة على جهازك (حاسوب، أبل iOS، أو أندرويد).
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => {
                  if (!('Notification' in window)) {
                    showToast('متصفحك لا يدعم الإشعارات الأصلية.', true);
                    return;
                  }
                  
                  if (Notification.permission === 'denied') {
                    setIsHelpOpen(true);
                    return;
                  }

                  try {
                    const permission = await Notification.requestPermission();
                    if (permission === 'granted') {
                      showToast('تم تفعيل إشعارات المتصفح بنجاح! 🎉');
                      try {
                        new Notification('مخطط الدراسة 📚', {
                          body: 'تم تفعيل إشعارات وتنبيهات الهاتف والكمبيوتر بنجاح وتعمل الآن بشكل ممتاز!',
                          icon: '/icon.png'
                        });
                      } catch (err) {
                        console.warn("Notification error", err);
                      }
                    } else if (permission === 'denied') {
                      setIsHelpOpen(true);
                      showToast('طلب التوثيق مرفوض، يرجى الاطلاع على الدليل المساعد للاستمرار.', true);
                    } else {
                      showToast('لم يتم اختيار تفعيل الإشعارات بعد.', true);
                    }
                  } catch (e) {
                    showToast('حدث خطأ أثناء طلب الإذن بالإشعارات.', true);
                  }
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-xs font-semibold text-white px-4 py-2.5 transition-colors cursor-pointer"
              >
                تفعيل الإشعارات وتنبيهات المتصفح 🔔
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!('Notification' in window)) {
                    showToast('متصفحك الحالي لا يدعم الإشعارات للتلفون/الكومبيوتر.', true);
                    return;
                  }
                  if (Notification.permission !== 'granted') {
                    showToast('يرجى تفعيل الإذن أولاً عن طريق الضغط على زر التفعيل المصاحب.', true);
                    return;
                  }
                  try {
                    new Notification('تذكير تجريبي 📱', {
                      body: 'رائع! هذا تذكير تجريبي للتطبيق والمساعد الذكي يرسل لهاتفك بنجاح!',
                      icon: '/icon.png'
                    });
                    showToast('تم إرسال إشعار تجريبي بنجاح!');
                  } catch (e) {
                    showToast('حدث خطأ أثناء تشغيل الإشعار التجريبي.', true);
                  }
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--surface)] text-xs font-semibold text-[var(--text)] px-4 py-2.5 transition-colors cursor-pointer"
              >
                إرسال إشعار تجريبي للهاتف 🧪
              </button>
            </div>

            <div className="rounded-lg bg-[var(--surface)] p-3 border border-[var(--border)]/50 space-y-2">
              <h5 className="text-[11px] font-bold text-[var(--text)] flex items-center gap-1.5">
                💡 دليل استقبال التنبيهات على الهواتف الذكية:
              </h5>
              <ul className="text-[11px] text-[var(--muted)] space-y-1.5 list-disc pr-4 pr-5 leading-relaxed">
                <li>
                  <b className="text-[var(--text)]">هواتف آيفون (iOS 16.4+):</b> قم بإضافة التطبيق إلى الشاشة الرئيسية بالضغط على زر <b>مشاركة (Share)</b> في متصفح Safari، ثم اختر <b>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</b>. افتح التطبيق من الشاشة الرئيسية، واضغط تفعيل الإشعارات.
                </li>
                <li>
                  <b className="text-[var(--text)]">هواتف أندرويد (Chrome/Firefox):</b> تأكد من منح الإذن لمتصفحك في إعدادات النظام، ومنع موفر الطاقة/البطارية من وضع متصفحك في حالة سكون تام.
                </li>
                <li>
                  يجب إبقاء علامة تبويب التطبيق في الخلفية لضمان عمل الفحص الدوري للمهام والتنبيهات الموقوتة بالدقيقة.
                </li>
              </ul>
            </div>
          </div>
        </div>

        <form onSubmit={handleChangePassword} className="space-y-4 pt-2 border-b border-[var(--border)] pb-6 theme-transition">
          <h4 className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
            <Lock className="h-4 w-4 text-[var(--muted)]" />
            تغيير كلمة المرور
          </h4>
          
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text)] mb-1">كلمة المرور الجديدة</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                placeholder="8 أحرف على الأقل"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text)] mb-1">تأكيد كلمة المرور</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                placeholder="تأكيد كلمة المرور الجديدة"
                dir="ltr"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isChangingPassword || !newPassword || !confirmPassword}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50"
          >
            {isChangingPassword ? 'جاري التحديث...' : 'تحديث كلمة المرور'}
          </button>
        </form>

        <div className="pt-2">
          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 cursor-pointer"
          >
            <LogOut className="h-5 w-5" />
            تسجيل الخروج
          </button>
        </div>
      </div>

      {/* Danger Zone (منطقة الخطر) */}
      <div className="rounded-2xl border border-red-200 bg-red-50/5 p-6 shadow-sm space-y-4 theme-transition">
        <div className="flex items-center gap-3 border-b border-red-100/50 pb-4 theme-transition">
          <div className="rounded-lg bg-red-500/10 p-2 text-red-600">
            <Trash2 className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-semibold text-red-600">منطقة الخطر (إجراءات حساسة)</h3>
        </div>

        <div className="space-y-4">
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            عند حذف حسابك، سيتم إزالة كافة البيانات الخاصة بك من خوادم التطبيق نهائياً وبشكل فوري. يشمل ذلك كافّة التحاضير، الواجبات المسجلة، جداول الحصص الأسبوعية، الإعدادات الخاصة بك، وملفك الشخصي. لن يكون بمقدورك استعادة أي من هذه البيانات في المستقبل.
          </p>

          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-300 bg-[var(--card)] hover:bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 transition-all cursor-pointer shadow-sm hover:shadow active:scale-95 duration-150"
            >
              <Trash2 className="h-4 w-4" />
              حذف الحساب نهائياً
            </button>
          ) : (
            <div className="p-4 rounded-xl border border-red-200 bg-red-100/5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="text-xs font-bold text-red-600 flex items-center gap-1.5">
                <span>⚠️ هل أنت متأكد تماماً من رغبتك في حذف الحساب نهائياً؟</span>
              </div>
              <p className="text-[11px] text-[var(--muted)]">
                يرجى كتابة كلمة <b className="text-red-600 font-bold">"حذف"</b> في الحقل أدناه لتأكيد رغبتك بالاستمرار:
              </p>
              
              <div className="space-y-3">
                <input
                  type="text"
                  value={deleteConfirmationWord}
                  onChange={(e) => setDeleteConfirmationWord(e.target.value)}
                  placeholder='اكتب "حذف" للتأكيد...'
                  className="w-full rounded-lg border border-red-200 bg-[var(--card)] px-3 py-2 text-xs text-[var(--text)] focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />

                <div className="flex gap-2">
                  <button
                    onClick={handleDeleteAccount}
                    disabled={isDeletingAccount || deleteConfirmationWord.trim() !== 'حذف'}
                    className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs px-4 py-2.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm"
                  >
                    {isDeletingAccount ? 'جاري الحذف والمسح...' : 'نعم، احذف حسابي وبياناتي نهائياً'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteConfirmationWord('');
                    }}
                    disabled={isDeletingAccount}
                    className="bg-[var(--surface)] hover:bg-[var(--border)] border border-[var(--border)] text-[var(--text)] text-xs px-4 py-2.5 rounded-lg font-medium transition-all cursor-pointer"
                  >
                    تراجع / إلغاء
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm space-y-6 theme-transition">
        <div className="flex items-center gap-3 border-b border-[var(--border)] pb-4 theme-transition">
          <div className="rounded-lg bg-[var(--primary)]/10 p-2 text-[var(--primary)]">
            <Clock className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-semibold text-[var(--text)]">أوقات الحصص</h3>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-[var(--text)]">عدد الحصص في اليوم</label>
            <select
              value={slotsCount}
              onChange={(e) => setSlotsCount(Number(e.target.value))}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] px-3 py-1.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            >
              {[...Array(12)].map((_, i) => (
                <option key={i + 1} value={i + 1}>{i + 1}</option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[...Array(slotsCount)].map((_, i) => {
              const slotNum = i + 1;
              return (
                <div key={slotNum} className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 theme-transition">
                  <span className="text-sm font-medium text-[var(--text)]">الحصة {slotNum}</span>
                  <input
                    type="time"
                    value={localSlots[slotNum] || '08:00'}
                    onChange={(e) => handleTimeChange(slotNum, e.target.value)}
                    className="rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--text)] px-2 py-1 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                    dir="ltr"
                  />
                </div>
              );
            })}
          </div>

          <button
            onClick={handleSaveSlots}
            disabled={isSaving}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50"
          >
            <Save className="h-5 w-5" />
            {isSaving ? 'جاري الحفظ...' : 'حفظ أوقات الحصص'}
          </button>
        </div>
      </div>

      <NotificationHelpDialog
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />
    </motion.div>
  );
}

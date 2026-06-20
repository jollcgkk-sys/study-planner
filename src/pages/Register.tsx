import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate, Link } from 'react-router-dom';
import { db } from '../lib/db';
import { uuid } from '../lib/uuid';
import { Mail, CheckCircle2, ArrowRight } from 'lucide-react';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'student' | 'teacher'>('student');
  const [name, setName] = useState('');
  const [teacherPassword, setTeacherPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    const displayName = name.trim();
    if (!displayName) {
      setError('⚠️ يرجى إدخال الاسم الكامل.');
      setLoading(false);
      return;
    }

    if (role === 'student') {
      const parts = displayName.split(/\s+/).filter(Boolean);
      if (parts.length < 3) {
        setError('⚠️ يرجى إدخال الاسم الثلاثي الحقيقي (الاسم الأول واسم الأب واسم الجد/العائلة) ليسهل على المعلم أو الدكتور العثور على حسابك.');
        setLoading(false);
        return;
      }
    }

    if (role === 'teacher') {
      if (teacherPassword !== 'A07830395151a@') {
        setError('⚠️ رمز تفعيل حساب معلّم/دكتور غير صحيح. يرجى إدخال رمز التحقق الصحيح للمتابعة.');
        setLoading(false);
        return;
      }
    }
    
    try {
       const { data, error } = await supabase.auth.signUp({ 
         email, 
         password,
         options: {
           data: {
             role: role,
             name: displayName
           }
         }
       });
       
       if (error) {
         if (error.message.includes('rate limit') || error.message.includes('Rate limit')) {
           setError('⚠️ تم تجاوز الحد المسموح لإرسال الطلبات. يرجى الانتظار لمدة دقيقة واحدة قبل محاولة التسجيل مجدداً.');
         } else {
           setError(error.message);
         }
       } else {
         // Auto register in local & remote student_profiles on signup success
         if (data?.user) {
           // Write directly to Supabase student_profiles
           const { error: remoteError } = await supabase.from('student_profiles').upsert({
             id: data.user.id,
             email: data.user.email || email,
             name: displayName,
             role: role,
             created_at: new Date().toISOString()
           });

           if (remoteError) {
             console.error('Failed to sync student profile to Supabase during registration:', remoteError);
           }

           await db.student_profiles.put({
             id: data.user.id,
             email: data.user.email || email,
             name: displayName,
             role: role,
             created_at: new Date().toISOString()
           }).catch(err => console.error(err));
         }
         // Set success state to display clear confirmation message to user
         setSignUpSuccess(true);
       }
    } catch (err: any) {
       console.error('Registration request failed:', err);
       if (err?.message?.includes('rate limit') || err?.message?.includes('Rate limit')) {
         setError('⚠️ تم تجاوز الحد المسموح لإرسال الطلبات. يرجى الانتظار لمدة دقيقة واحدة قبل محاولة التسجيل مجدداً.');
       } else {
         setError(err?.message || 'فشل الاتصال بالسيرفر. يرجى التحقق من اتصالك بالإنترنت.');
       }
    }
    setLoading(false);
  };

  if (signUpSuccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--surface)] px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-6 rounded-2xl bg-[var(--card)] p-8 shadow-xl border border-[var(--border)] text-center animate-in fade-in duration-300">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-10 w-10" />
          </div>
          
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-[var(--text)]">🎉 تم التسجيل بنجاح!</h2>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              لقد أرسلنا بريداً إلكترونياً لتفعيل الحساب إلى:
              <strong className="block text-emerald-600 dark:text-emerald-400 mt-1 font-semibold select-all" dir="ltr">{email}</strong>
            </p>
          </div>

          <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-200/30 text-right space-y-2">
            <span className="flex items-center gap-2 text-xs font-bold text-blue-600 dark:text-blue-400">
              <Mail className="h-4 w-4" />
              خطوة التفعيل المطلوبة:
            </span>
            <p className="text-xs text-[var(--muted)] leading-relaxed font-semibold">
              ⚠️ يرجى فتح حساب <strong className="text-blue-600 dark:text-blue-400">جيميل (Gmail)</strong> الخاص بك، والبحث عن رسالة تأكيد الحساب من البريد، والضغط على زر <strong className="text-blue-600 dark:text-blue-400">تفعيل الحساب (Confirm your mail)</strong> لتتمكن من تسجيل الدخول بنجاح.
            </p>
            <p className="text-[10px] text-amber-500 leading-relaxed font-medium mt-1">
              * في حال لم تجد الرسالة في صندوق الوارد، يرجى فحص مجلد "البريد غير الهام أو العشوائي" (Spam / Junk).
            </p>
          </div>

          <div className="pt-2">
            <Link
              to="/login"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[var(--primary)]/90 transition-all"
            >
              <span>الانتقال لصفحة تسجيل الدخول</span>
              <ArrowRight className="h-4 w-4 rotate-180" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface)] px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-xl bg-[var(--card)] p-8 shadow-lg">
        <div>
          <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-[var(--text)]">
            إنشاء حساب جديد
          </h2>
          <p className="mt-2 text-center text-sm text-[var(--muted)]">
            اختر دورك التعليمي المناسب للاستفادة الكاملة من ميزات النظام
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleRegister}>
          {error && <div className="text-red-500 text-sm text-center bg-red-50 p-2.5 rounded-lg border border-red-200">{error}</div>}
          
          {/* Role selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--text)] block">الدور الأكاديمي</label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-[var(--surface)] rounded-xl border border-[var(--border)]">
              <button
                type="button"
                onClick={() => setRole('student')}
                className={`py-2 px-4 rounded-lg text-sm font-semibold transition-all ${
                  role === 'student'
                    ? 'bg-[var(--primary)] text-white shadow-sm'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                👨‍🎓 طالب
              </button>
              <button
                type="button"
                onClick={() => setRole('teacher')}
                className={`py-2 px-4 rounded-lg text-sm font-semibold transition-all ${
                  role === 'teacher'
                    ? 'bg-[var(--primary)] text-white shadow-sm'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                👨‍🏫 مدرس / دكتور
              </button>
            </div>
          </div>

          <div className="space-y-4 rounded-md">
            <div>
              <label className="text-xs font-semibold text-[var(--muted)] mb-1 block">
                {role === 'student' ? 'الاسم الثلاثي الحقيقي (مطلوب)' : 'الاسم الكامل اللقب العلمي'}
              </label>
              <input
                type="text"
                required
                className="relative block w-full appearance-none rounded-lg border border-[var(--border)] px-3 py-2 text-[var(--text)] placeholder-[var(--muted)] focus:z-10 focus:border-[var(--primary)] focus:outline-none focus:ring-[var(--primary)] sm:text-sm"
                placeholder={role === 'student' ? "محمد أحمد آل علي (اسم ثلاثي)" : "د. خالد يوسف (الاسم الكامل)"}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {role === 'student' && (
                <p className="text-[11px] text-[var(--muted)] mt-1 font-medium">
                  ⚠️ يجب كتابة اسمك الثلاثي الحقيقي لتسهيل عثور المدرس على حسابك في كشوفات الشعب والدرجات.
                </p>
              )}
            </div>

            {role === 'teacher' && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-amber-600 block">
                  كود تفعيل حساب المعلم / الدكتور
                </label>
                <input
                  type="password"
                  required
                  placeholder="أدخل كلمة سر تفعيل وضع المعلم"
                  className="relative block w-full appearance-none rounded-lg border border-amber-300 px-3 py-2 text-[var(--text)] placeholder-[var(--muted)] focus:z-10 focus:border-[var(--primary)] focus:outline-none sm:text-sm bg-amber-50/5"
                  value={teacherPassword}
                  onChange={(e) => setTeacherPassword(e.target.value)}
                />
                <p className="text-[10px] text-amber-500 font-medium">
                  لوضع المعلم صلاحيات وضع التحاضير والمهام ومتابعة أداء الطلاب، يرجى إدخال كلمة سر تفعيل وضع المعلم الخاصة بالنظام.
                </p>
              </div>
            )}
            
            <div>
              <label className="sr-only">البريد الإلكتروني</label>
              <input
                type="email"
                required
                className="relative block w-full appearance-none rounded-lg border border-[var(--border)] px-3 py-2 text-[var(--text)] placeholder-[var(--muted)] focus:z-10 focus:border-[var(--primary)] focus:outline-none focus:ring-[var(--primary)] sm:text-sm"
                placeholder="البريد الإلكتروني"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            
            <div>
              <label className="sr-only">كلمة المرور</label>
              <input
                type="password"
                required
                className="relative block w-full appearance-none rounded-lg border border-[var(--border)] px-3 py-2 text-[var(--text)] placeholder-[var(--muted)] focus:z-10 focus:border-[var(--primary)] focus:outline-none focus:ring-indigo-500 sm:text-sm"
                placeholder="كلمة المرور"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative flex w-full justify-center rounded-md border border-transparent bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--primary)]/90 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {loading ? 'جاري التسجيل...' : 'تسجيل'}
            </button>
          </div>
          <div className="text-center text-sm">
            <Link to="/login" className="font-medium text-[var(--primary)] hover:text-[var(--primary)]">
              لديك حساب بالفعل؟ سجل دخول
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

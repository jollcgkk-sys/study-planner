import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // Extract proposed password if passed as query param 'p' (automatic click flow)
  const autoPassword = searchParams.get('p');
  const [isAutomated, setIsAutomated] = useState(!!autoPassword);
  const [autoStatus, setAutoStatus] = useState<'loading' | 'success' | 'error'>('loading');

  useEffect(() => {
    if (autoPassword) {
      setIsAutomated(true);
      let isApplied = false;

      // Handle the automatic password reset once Supabase establishes the session from the URL hash
      const handleAutoUpdate = async (session: any) => {
        if (isApplied || !session) return;
        isApplied = true;
        try {
          const { error: updateError } = await supabase.auth.updateUser({ password: autoPassword });
          if (updateError) {
            console.error('Auto update password failed:', updateError);
            setError(updateError.message);
            setAutoStatus('error');
          } else {
            setSuccess('🎉 تم تفعيل كلمة المرور الجديدة بنجاح ودون الحاجة لإعادة كتابتها!');
            setAutoStatus('success');
            setTimeout(() => {
              navigate('/dashboard');
            }, 3000);
          }
        } catch (err: any) {
          console.error('Password auto-update exception:', err);
          setError(err?.message || 'حدث خطأ غير متوقع أثناء تفعيل كلمة المرور.');
          setAutoStatus('error');
        }
      };

      // 1. Check if we already have an active session
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          handleAutoUpdate(session);
        }
      });

      // 2. Listen to state changes (when hash token is digested by Supabase client)
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' || session) {
          handleAutoUpdate(session);
        }
      });

      // Timeout fallback if it takes too long to authenticate or the token is invalid
      const timeoutId = setTimeout(() => {
        if (!isApplied) {
          setError('انتهت مهلة التحقق من صلاحية البريد الإلكتروني. يرجى التأكد من الضغط على الرابط الصحيح المرسل لك.');
          setAutoStatus('error');
        }
      }, 12000);

      return () => {
        subscription.unsubscribe();
        clearTimeout(timeoutId);
      };
    } else {
      // Manual flow: check if current URL possesses the access_token in its hash
      const checkHasToken = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session && !window.location.hash.includes('access_token')) {
          setError('رابط تعيين كلمة المرور غير صالح أو منتهي الصلاحية. يرجى طلب رابط جديد.');
        }
      };
      checkHasToken();
    }
  }, [autoPassword, navigate]);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين.');
      return;
    }
    if (password.length < 6) {
      setError('يجب أن تكون كلمة المرور 6 أحرف على الأقل.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError(error.message);
      } else {
        setSuccess('تم تحديث كلمة المرور بنجاح! سيتم تحويلك إلى لوحة التحكم خلال ثوانٍ...');
        setTimeout(() => {
          navigate('/dashboard');
        }, 3000);
      }
    } catch (err: any) {
      console.error('Password update failed:', err);
      setError(err?.message || 'حدث خطأ أثناء تحديث كلمة المرور.');
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface)] px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-xl bg-[var(--card)] p-8 shadow-lg border border-[var(--border)]">
        <div>
          {/* Decorative Pink Touch */}
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-pink-100 text-pink-600 text-2xl">
            🧁
          </div>
          <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-[var(--text)]">
            {isAutomated ? 'استعادة وتفعيل الحساب' : 'تعيين كلمة مرور جديدة'}
          </h2>
          <p className="mt-2 text-center text-sm text-[var(--muted)]">
            {isAutomated 
              ? 'يرجى الانتظار، نقوم حالياً بتأكيد هويتك وتفعيل كلمة المرور تلقائياً...' 
              : 'أدخل كلمة المرور الجديدة لحسابك أدناه للمتابعة.'}
          </p>
        </div>

        {isAutomated ? (
          <div className="space-y-6 text-center">
            {autoStatus === 'loading' && (
              <div className="py-6 flex flex-col items-center justify-center space-y-4">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[var(--primary)]"></div>
                <p className="text-sm text-[var(--muted)] animate-pulse">جاري الاتصال بـ Supabase والتحقق من حسابك...</p>
              </div>
            )}

            {autoStatus === 'success' && (
              <div className="py-6 text-center space-y-4">
                <div className="text-5xl animate-bounce">👍</div>
                <div className="text-green-600 text-sm font-semibold bg-green-50 p-3 rounded-lg border border-green-200">
                  {success}
                </div>
                <p className="text-xs text-[var(--muted)]">جاري نقلك للوحة التحكم تلقائياً، يرجى الانتظار...</p>
              </div>
            )}

            {autoStatus === 'error' && (
              <div className="py-6 space-y-4">
                <div className="text-red-500 text-sm bg-red-50 p-3 rounded-lg border border-red-200">
                  {error}
                </div>
                <div className="text-xs text-[var(--muted)]">
                  يمكنك محاولة طلب رابط جديد، أو الانتقال للوحة التحكم للتحديث اليدوي.
                </div>
                <div className="pt-4">
                  <Link to="/login" className="font-medium text-[var(--primary)] hover:underline">
                    العودة لتسجيل الدخول
                  </Link>
                </div>
              </div>
            )}
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleReset}>
            {error && <div className="text-red-500 text-sm text-center bg-red-50 p-2.5 rounded-lg border border-red-200">{error}</div>}
            {success && <div className="text-green-600 text-sm text-center bg-green-50 p-2.5 rounded-lg border border-green-200">{success}</div>}

            <div className="space-y-4 rounded-md">
              <div>
                <label className="sr-only">كلمة المرور الجديدة</label>
                <input
                  type="password"
                  required
                  className="relative block w-full appearance-none rounded-lg border border-[var(--border)] px-3 py-2.5 text-[var(--text)] placeholder-[var(--muted)] focus:z-10 focus:border-[var(--primary)] focus:outline-none focus:ring-[var(--primary)] sm:text-sm"
                  placeholder="كلمة المرور الجديدة"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="sr-only">تأكيد كلمة المرور</label>
                <input
                  type="password"
                  required
                  className="relative block w-full appearance-none rounded-lg border border-[var(--border)] px-3 py-2.5 text-[var(--text)] placeholder-[var(--muted)] focus:z-10 focus:border-[var(--primary)] focus:outline-none focus:ring-[var(--primary)] sm:text-sm"
                  placeholder="تأكيد كلمة المرور الجديدة"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="group relative flex w-full justify-center rounded-lg border border-transparent bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--primary)]/90 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50"
              >
                {loading ? 'جاري تعيين كلمة المرور...' : 'تحديث كلمة المرور'}
              </button>
            </div>

            <div className="text-center text-sm">
              <Link to="/login" className="font-medium text-[var(--primary)] hover:text-[var(--primary)]">
                العودة لتسجيل الدخول
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

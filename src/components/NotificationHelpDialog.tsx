import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Smartphone, AlertOctagon, HelpCircle, Laptop, Settings, ExternalLink, Volume2 } from 'lucide-react';
import { playNotificationChime } from '../lib/chime';

interface NotificationHelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NotificationHelpDialog({ isOpen, onClose }: NotificationHelpDialogProps) {
  const [activeTab, setActiveTab] = useState<'iphone' | 'android' | 'desktop'>('iphone');
  const [isIframe, setIsIframe] = useState(false);

  useEffect(() => {
    // Detect if inside an iframe (like the AI Studio preview window)
    setIsIframe(window.self !== window.top);
  }, []);

  const testChime = () => {
    playNotificationChime();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs"
        />

        {/* Content */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl theme-transition"
          dir="rtl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
            <div className="flex items-center gap-2">
              <div className="rounded-xl bg-amber-500/10 p-2 text-amber-500">
                <AlertOctagon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-lg text-[var(--text)]">كيفية تفعيل إشعارات وتنبيهات الهاتف</h3>
                <p className="text-xs text-[var(--muted)]">حل مشكلة الإذن المرفوض أو عدم ظهور التنبيهات</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            {/* If in iframe warning */}
            {isIframe && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-2">
                <div className="flex items-center gap-2 text-amber-500 font-semibold text-xs">
                  <ExternalLink className="h-4 w-4 shrink-0" />
                  <span>تنبيه هام: أنت تشاهد التطبيق داخل إطار تجريبي (iFrame)</span>
                </div>
                <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                  تمنع المتصفحات طلب إذن الإشعارات تلقائياً داخل الإطارات التجريبية لحمايتك. لتفعيل واستقبال التنبيهات بنجاح على هاتفك أو حاسوبك، يجب فتح التطبيق في علامة تبويب مستقلة تماماً.
                </p>
                <div className="pt-1">
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-[11px] transition-colors shadow-xs cursor-pointer"
                  >
                    فتح التطبيق في نافذة مستقلة للموافقة على الإذن 🚀
                  </a>
                </div>
              </div>
            )}

            {/* General Explanation for Denied status */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--text)] space-y-2">
              <p className="leading-relaxed">
                إذا قمت بـ <b className="text-red-500">Block / رفض</b> إذن الإشعارات للموقع سابقاً، فلن يتمكن المتصفح من إظهار نافذة الطلب مجدداً بشكل تلقائي لحمايتك. اتبع التعليمات ومحددات النظام أدناه لفك الحظر وتفعيل الإشعارات:
              </p>
            </div>

            {/* Tabs selector */}
            <div className="flex border-b border-[var(--border)] gap-1">
              <button
                type="button"
                onClick={() => setActiveTab('iphone')}
                className={`flex-1 pb-2 pt-1 text-center text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                  activeTab === 'iphone'
                    ? 'border-[var(--primary)] text-[var(--primary)]'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                هواتف الآيفون (iOS)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('android')}
                className={`flex-1 pb-2 pt-1 text-center text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                  activeTab === 'android'
                    ? 'border-[var(--primary)] text-[var(--primary)]'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                هواتف الأندرويد
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('desktop')}
                className={`flex-1 pb-2 pt-1 text-center text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                  activeTab === 'desktop'
                    ? 'border-[var(--primary)] text-[var(--primary)]'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                أجهزة الكمبيوتر
              </button>
            </div>

            {/* Tab contents */}
            <div className="space-y-3 pt-2 text-xs leading-relaxed text-[var(--muted)]">
              {activeTab === 'iphone' && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-[13px] text-[var(--text)] flex items-center gap-1.5">
                    <Smartphone className="h-4 w-4 text-[var(--primary)]" />
                    تعليمات تفعيل التنبيهات على هواتف الآيفون (إصدار iOS 16.4 والإصدارات الأحدث):
                  </h4>
                  <ol className="list-decimal pr-5 space-y-2">
                    <li>
                      افتح التطبيق في متصفح <b className="text-[var(--text)]">Safari</b> الافتراضي للآيفون.
                    </li>
                    <li>
                      اضغط على زر <b className="text-[var(--text)]">مشاركة (Share)</b> في أسفل المتصفح (زر السهم الطائر).
                    </li>
                    <li>
                      اختر من القائمة المنسدلة <b className="text-[var(--text)]">إضافة إلى الشاشة الرئيسية (Add to Home Screen)</b>.
                    </li>
                    <li>
                      أغلق المتصفح واذهب إلى الشاشة الرئيسية للتلفون لتجد أيقونة التطبيق مضافة كـ WebApp.
                    </li>
                    <li>
                      قم بفتح التطبيق من خلال الأيقونة الجديدة، وسيطالبك فوراً بطلب إذن التنبيهات؛ وافق بسعادة لتصلك كافة التذكيرات حتى لو كان هاتفك مغلقاً!
                    </li>
                  </ol>
                </div>
              )}

              {activeTab === 'android' && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-[13px] text-[var(--text)] flex items-center gap-1.5">
                    <Smartphone className="h-4 w-4 text-[var(--primary)]" />
                    خطوات إعادة تفعيل الإذن على أندرويد (Chrome / Firefox):
                  </h4>
                  <ol className="list-decimal pr-5 space-y-2">
                    <li>
                      اضغط على رمز <b className="text-[var(--text)]">النطاق / شريط العنوان</b> في الأعلى (أيقونة القفل أو النقاط الثلاث بجوار رابط الموقع).
                    </li>
                    <li>
                      اختر <b className="text-[var(--text)]">إذن الموقع (Site permissions)</b> أو <b className="text-[var(--text)]">الإعدادات (Settings)</b>.
                    </li>
                    <li>
                      ابحث عن "الإشعارات" وقم بتحويلها إلى <b className="text-[var(--text)] text-emerald-500">سماح (Allow)</b>.
                    </li>
                    <li>
                      اضغط أيضاً على زر "إضافة للشاشة الرئيسية" المتوفر في إعدادات متصفح Chrome لإنشاء اختصار للهاتف لضمان عدم توقف العمل في الخلفية.
                    </li>
                    <li>
                      تأكد من إلغاء خاصية "توفير وقت طاقة البطارية" القصوى للتطبيق من إعدادات النظام وتفعيل وضع البدء التلقائي.
                    </li>
                  </ol>
                </div>
              )}

              {activeTab === 'desktop' && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-[13px] text-[var(--text)] flex items-center gap-1.5">
                    <Laptop className="h-4 w-4 text-[var(--primary)]" />
                    خطوات مخصصة لأجهزة الكمبيوتر (Windows / macOS / Linux):
                  </h4>
                  <ol className="list-decimal pr-5 space-y-2">
                    <li>
                      في متصفحك (Chrome, Edge, Opera, Safari) انظر في شريط العنوان بالأعلى بجوار الرابط.
                    </li>
                    <li>
                      سترى أيقونة ترمز لـ <b className="text-[var(--text)]">قفل الحماية (Padlock)</b> أو التحكم بالأذونات. اضغط عليها.
                    </li>
                    <li>
                      ابحث عن خيار <b className="text-[var(--text)]">الإشعارات (Notifications)</b> وقم بتغيير حالتها من "حظر" إلى <b className="text-emerald-500">سماح (Allow)</b>.
                    </li>
                    <li>
                      قم بإعادة تحميل الصفحة (F5) لتحديث التغييرات وتفعيل الاتصال!
                    </li>
                  </ol>
                </div>
              )}
            </div>

            {/* In-app sound trigger for testing */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 flex items-center justify-between mt-2">
              <div className="space-y-0.5">
                <h5 className="font-semibold text-xs text-[var(--text)]">جرب الصوت والرنين 🔔</h5>
                <p className="text-[10px] text-[var(--muted)]">اختبر نغمة التذكير الموسيقية للهاتف والكمبيوتر</p>
              </div>
              <button
                type="button"
                onClick={testChime}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--primary)]/30 hover:bg-[var(--primary)]/10 text-xs font-semibold text-[var(--primary)] transition-colors cursor-pointer"
              >
                <Volume2 className="h-4 w-4" />
                رنين تجريبي
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-6 flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl transition-colors cursor-pointer"
            >
              مفهوم، سأجرب ذلك الآن 👍
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

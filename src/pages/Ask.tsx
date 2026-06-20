import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Task, Subject, WeeklySchedule, DayNote } from '../lib/db';
import { useAuth } from '../contexts/AuthContext';
import { queueMutation } from '../lib/sync';
import { uuid } from '../lib/uuid';
import { Search, Send, Sparkles, Loader2, Key, CheckCircle, AlertTriangle, ExternalLink, RefreshCw, Trash2, Eye, EyeOff } from 'lucide-react';
import TaskCard from '../components/TaskCard';
import TaskDialog from '../components/TaskDialog';
import { startOfWeek, addDays, format, getISODay } from 'date-fns';
import { supabase } from '../lib/supabase';

export default function Ask() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ tasks: Task[], schedule: WeeklySchedule[], notes: DayNote[], subjects?: Subject[] } | null>(null);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>(undefined);

  // Custom client-side Gemini API key states
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [apiKeyInput, setApiKeyInput] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('gemini_model') || 'gemini-2.5-flash');
  const [showKeyForm, setShowKeyForm] = useState(!localStorage.getItem('gemini_api_key'));
  const [showPassword, setShowPassword] = useState(false);
  const [localToast, setLocalToast] = useState<{ message: string; isError?: boolean } | null>(null);

  const showLocalToast = (message: string, isError = false) => {
    setLocalToast({ message, isError });
    setTimeout(() => setLocalToast(null), 5000);
  };

  const userSettings = useLiveQuery(() => user ? db.user_settings.get(user.id) : null, [user?.id]);

  useEffect(() => {
    if (userSettings) {
      if (userSettings.gemini_api_key) {
        setApiKey(userSettings.gemini_api_key);
        setApiKeyInput(userSettings.gemini_api_key);
        setShowKeyForm(false);
        // Robustness: Write to localStorage automatically if synced from cloud to another device
        if (localStorage.getItem('gemini_api_key') !== userSettings.gemini_api_key) {
          localStorage.setItem('gemini_api_key', userSettings.gemini_api_key);
        }
      } else {
        const localKey = localStorage.getItem('gemini_api_key');
        if (!localKey) {
          setApiKey('');
          setApiKeyInput('');
          setShowKeyForm(true);
        }
      }
      if (userSettings.gemini_model) {
        setSelectedModel(userSettings.gemini_model);
        if (localStorage.getItem('gemini_model') !== userSettings.gemini_model) {
          localStorage.setItem('gemini_model', userSettings.gemini_model);
        }
      }
    }
  }, [userSettings]);

  const handleSaveKey = async () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      showLocalToast('يرجى إدخال مفتاح API صحيح', true);
      return;
    }
    localStorage.setItem('gemini_api_key', trimmed);
    localStorage.setItem('gemini_model', selectedModel);
    setApiKey(trimmed);
    setShowKeyForm(false);
    
    if (user) {
      try {
        const currentSettings = await db.user_settings.get(user.id);
        const updatedSettings = {
          user_id: user.id,
          slot_count: currentSettings?.slot_count ?? 6,
          theme_key: currentSettings?.theme_key ?? 'default',
          reduce_motion: currentSettings?.reduce_motion ?? false,
          gemini_api_key: trimmed,
          gemini_model: selectedModel,
          updated_at: new Date().toISOString()
        };
        await queueMutation('upsert_user_settings', updatedSettings, user.id);
        showLocalToast('تم حفظ مفتاح API وتزامن إعدادات الذكاء الاصطناعي مع حسابك في Supabase بنجاح!');
      } catch (err) {
        console.error("Failed to save settings to cloud", err);
        showLocalToast('تم حفظ المفتاح محلياً، ولكن حدث خطأ أثناء المزامنة السحابية');
      }
    } else {
      showLocalToast('تم حفظ مفتاح API وتفعيل الذكاء الاصطناعي محلياً بنجاح!');
    }
  };

  const handleDeleteKey = async () => {
    localStorage.removeItem('gemini_api_key');
    setApiKey('');
    setApiKeyInput('');
    setShowKeyForm(true);
    
    if (user) {
      try {
        const currentSettings = await db.user_settings.get(user.id);
        const updatedSettings = {
          user_id: user.id,
          slot_count: currentSettings?.slot_count ?? 6,
          theme_key: currentSettings?.theme_key ?? 'default',
          reduce_motion: currentSettings?.reduce_motion ?? false,
          gemini_api_key: null,
          gemini_model: null,
          updated_at: new Date().toISOString()
        };
        await queueMutation('upsert_user_settings', updatedSettings, user.id);
        showLocalToast('تم حذف مفتاح API ومزامنة ذلك مع السحابة بنجاح');
      } catch (err) {
        console.error("Failed to delete settings from cloud", err);
        showLocalToast('تم حذف المفتاح محلياً ولكن فشل تحديث السحابة');
      }
    } else {
      showLocalToast('تم حذف مفتاح API محلياً بنجاح');
    }
  };

  const tasks = useLiveQuery(() => db.tasks.where('user_id').equals(user?.id || '').toArray(), [user?.id]) || [];
  const subjects = useLiveQuery(() => db.subjects.where('user_id').equals(user?.id || '').toArray(), [user?.id]) || [];
  const schedule = useLiveQuery(() => db.weekly_schedule.where('user_id').equals(user?.id || '').toArray(), [user?.id]) || [];
  const notes = useLiveQuery(() => db.day_notes.where('user_id').equals(user?.id || '').toArray(), [user?.id]) || [];

  const subjectMap = subjects.reduce((acc, sub) => {
    acc[sub.id] = sub;
    return acc;
  }, {} as Record<string, Subject>);

  const handleToggleDone = async (id: string, isDone: boolean) => {
    if (!user) return;
    const task = await db.tasks.get(id);
    if (task) {
      const updated = { ...task, is_done: isDone, updated_at: new Date().toISOString() };
      await queueMutation('update_task', updated, user.id);
      if (results) {
        setResults({
          ...results,
          tasks: results.tasks.map(t => t.id === id ? updated : t)
        });
      }
    }
  };

  const handleToggleImportant = async (id: string, isImportant: boolean) => {
    if (!user) return;
    const task = await db.tasks.get(id);
    if (task) {
      const updated = { ...task, is_important: isImportant, updated_at: new Date().toISOString() };
      await queueMutation('update_task', updated, user.id);
      if (results) {
        setResults({
          ...results,
          tasks: results.tasks.map(t => t.id === id ? updated : t)
        });
      }
    }
  };

  const handleDeleteTask = async (id: string) => {
    if (!user) return;
    await queueMutation('delete_task', { id }, user.id);
    if (results) {
      setResults({
        ...results,
        tasks: results.tasks.filter(t => t.id !== id)
      });
    }
  };

  const handleTaskSubmit = async (taskData: Partial<Task>) => {
    if (!user) return;

    if (editingTask) {
      const updated = { ...editingTask, ...taskData, updated_at: new Date().toISOString() };
      await queueMutation('update_task', updated, user.id);
      if (results) {
        setResults({
          ...results,
          tasks: results.tasks.map(t => t.id === updated.id ? updated : t)
        });
      }
    } else {
      const newTask: Task = {
        id: uuid(),
        user_id: user.id,
        subject_id: taskData.subject_id || null,
        type: taskData.type as any,
        title: taskData.title || '',
        details: taskData.details || '',
        due_at: taskData.due_at || null,
        remind_at: taskData.remind_at || null,
        is_done: taskData.is_done || false,
        is_important: taskData.is_important || false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await queueMutation('create_task', newTask, user.id);
      if (results) {
        setResults({
          ...results,
          tasks: [newTask, ...results.tasks]
        });
      }
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setAiAnswer(null);
    setResults(null);

    try {
      console.log("ASK DEBUG user.id:", user?.id);
      console.log("ASK DEBUG tasks count:", tasks.length, tasks.slice(0,3));

      const context = `
      User's Subjects: ${JSON.stringify(subjects.map(s => ({ id: s.id, name: s.name })))}
      User's Tasks: ${JSON.stringify(tasks.map(t => ({ id: t.id, title: t.title, type: t.type, due_at: t.due_at, is_done: t.is_done, subject_id: t.subject_id })))}
      User's Schedule: ${JSON.stringify(schedule.map(s => ({ day_of_week: s.day_of_week, subject_id: s.subject_id })))}
      Current Date/Time: ${new Date().toISOString()}
      Current Day of Week: ${getISODay(new Date()) - 1} (0=Monday, 6=Sunday)
      `;

      const prompt = `
      You are a smart study planner assistant. The user is asking a question in Arabic.
      If the user is asking to see their schedule, tasks, or subjects, extract the relevant filters and provide a brief summary. Set isGeneralQuestion to false.
      If the user is asking a general study question, asking for advice, or greeting you, provide a helpful response. Set isGeneralQuestion to true.
      
      CRITICAL: For targetTypes, ONLY use the exact string values: 'prep', 'homework', 'project', 'subject_note'.
      CRITICAL: The Context below is the ONLY source of truth. Do NOT invent tasks, homework, or schedule items. If it's not in the Context, it doesn't exist.
      
      Context:
      ${context}

      User Question: ${query}
      `;

      let data: any = null;

      if (!apiKey || !apiKey.trim()) {
        showLocalToast('الرجاء إدخال مفتاح API الخاص بك لتفعيل خدمات الذكاء الاصطناعي.', true);
        setShowKeyForm(true);
        fallbackSearch();
        setIsLoading(false);
        return;
      }

      const activeModel = selectedModel || "gemini-2.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
      
      const payload = {
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              isGeneralQuestion: {
                type: "BOOLEAN",
                description: "True if the question is general study help, chat, greetings, or study advice. False if searching or retrieving their schedule, tasks, or subjects."
              },
              answer: {
                type: "STRING",
                description: "Direct helpful response in Arabic (friendly study assistant tone). Must answer any general questions fully in Arabic, or write a short brief intro for specific schedule data."
              },
              targetTypes: {
                type: "ARRAY",
                items: { type: "STRING" },
                description: "Desired task types: 'prep', 'homework', 'project', 'subject_note'."
              },
              isAllTasks: { type: "BOOLEAN" },
              isImportantOnly: { type: "BOOLEAN" },
              isProjectsOnly: { type: "BOOLEAN" },
              targetDay: { type: "INTEGER", description: "Day index 0 to 6 (0=Monday, 6=Sunday), or null." },
              targetSubjectId: { type: "STRING", description: "The UUID of the subject if named, or null." }
            },
            required: ["isGeneralQuestion", "answer"]
          }
        }
      };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        let errorMsg = errorData?.error?.message || `Error status: ${res.status}`;
        
        if (errorMsg.includes("API key not valid") || errorMsg.includes("key is invalid")) {
          errorMsg = "مفتاح API المدخل غير صالح. يرجى التأكد من نسخه بشكل صحيح من Google AI Studio.";
        } else if (errorMsg.includes("quota") || errorMsg.includes("429")) {
          errorMsg = "تم تجاوز حد الاستهلاك المسموح به لمفتاح API هذا. يرجى الانتظار قليلاً أو تبديل المفتاح.";
        }

        showLocalToast(`خطأ في طلب الذكاء الاصطناعي: ${errorMsg}`, true);
        fallbackSearch();
        setIsLoading(false);
        return;
      }

      const responseJson = await res.json();
      const rawText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!rawText) {
        throw new Error("لم تستجب خدمة الذكاء الاصطناعي بأي محتوى.");
      }

      data = JSON.parse(rawText);

      console.log("ASK DEBUG AI data:", data);

      if (data) {
        const q = query.toLowerCase();
        const taskKeywords = [
          "واجب", "واجبات", "فرض", "فروض", "اختبار", "اختبارات", "امتحان", "امتحانات",
          "تحضير", "تحاضير", "أحضر", "احضر", "مشروع", "مشاريع", "بروجكت", "البحث", "بحث",
          "ملاحظة", "ملاحظات", "نوت", "ملخص", "ملخصات", "مهام", "مهمة", "تاسك", "تاسكات",
          "جدول", "جدولي", "حصص", "حصة", "كلاس", "كلاسات", "وش علي", "وش عندي",
          "بكرة", "بكره", "اليوم", "أمس", "امس"
        ];
        if (taskKeywords.some(kw => q.includes(kw))) {
          data.isGeneralQuestion = false;
        }

        if (data.isGeneralQuestion) {
          // Show AI answer and don't show results section for general questions
          setAiAnswer(data.answer);
          setResults(null);
          return;
        }

        // Apply filters based on parsed intent
        let filteredTasks = tasks.filter(t => !t.is_done);
        let filteredSchedule: WeeklySchedule[] = [];
        let filteredNotes: DayNote[] = [];

        // Helper to normalize date
        const normalizeDateYYYYMMDD = (dateStr: string | null | undefined) => {
          if (!dateStr) return null;
          try {
            return format(new Date(dateStr), 'yyyy-MM-dd');
          } catch {
            return null;
          }
        };

        const typeKeywordsMap: Record<string, string[]> = {
          prep: ['تحضير', 'تحاضير', 'أحضر', 'احضر'],
          homework: ['واجب', 'واجبات', 'فرض', 'فروض'],
          project: ['مشروع', 'مشاريع', 'بروجكت', 'البحث', 'بحث'],
          subject_note: ['ملاحظة', 'ملاحظات', 'نوت', 'ملخص', 'ملخصات']
        };

        let targetTypes: string[] = data.targetTypes || [];
        // Handle if AI returns a single string by mistake
        if (data.targetType && typeof data.targetType === 'string') {
          targetTypes.push(data.targetType);
        }

        // Map any Arabic types returned by mistake
        const validTypes = ['prep', 'homework', 'project', 'subject_note'];
        targetTypes = targetTypes.map(t => {
           if (t.includes('تحضير')) return 'prep';
           if (t.includes('واجب')) return 'homework';
           if (t.includes('مشروع')) return 'project';
           if (t.includes('ملاحظ')) return 'subject_note';
           return t;
        }).filter(t => validTypes.includes(t));

        // Fallback to query text if AI missed it
        if (targetTypes.length === 0) {
           if (q.includes('تحضير') || q.includes('تحاضير')) targetTypes.push('prep');
           if (q.includes('واجب')) targetTypes.push('homework');
           if (q.includes('مشروع') || q.includes('مشاريع')) targetTypes.push('project');
           if (q.includes('ملاحظ')) targetTypes.push('subject_note');
        }

        let isAllTasks = data.isAllTasks || q.includes('كل المهام') || q.includes('المهام كلها');
        let isImportantOnly = data.isImportantOnly || q.includes('مهم');
        let isProjectsOnly = data.isProjectsOnly || q.includes('مشروع') || q.includes('مشاريع');
        const isSubjectsQuery = q.includes('مادة') || q.includes('مواد') || q.includes('المسجلة') || q.includes('مسجل') || q.includes('مسجله') || q.includes('المواد');
        let filteredSubjects: Subject[] = [];
        
        if (isProjectsOnly && !targetTypes.includes('project')) {
          targetTypes.push('project');
        }

        let targetDay = data.targetDay;
        // Fallback for targetDay if AI missed it but user said "اليوم" or "غدا"
        if (targetDay === null || targetDay === undefined) {
           if (q.includes('اليوم')) targetDay = getISODay(new Date()) - 1;
           else if (q.includes('غدا') || q.includes('غدًا') || q.includes('باجر')) targetDay = getISODay(new Date()) % 7;
        } else {
           // AI might guess the day even if not explicitly mentioned. Verify if a day word was actually in the query.
           const dayWords = ['احد', 'أحد', 'اثنين', 'إثنين', 'ثلاثاء', 'اربعاء', 'أربعاء', 'خميس', 'جمعة', 'جمعه', 'سبت', 'يوم', 'غدا', 'غدًا', 'باجر', 'اليوم', 'أمس', 'امس'];
           const hasDayWord = dayWords.some(w => q.includes(w));
           if (!hasDayWord) {
             targetDay = null; // Ignore AI's day guess if user didn't mention time
           }
        }

        let targetSubjectId = data.targetSubjectId;
        if (!targetSubjectId) {
          // Dynamic fuzzy match
          for (const sub of subjects) {
            const subName = sub.name.toLowerCase();
            const subNameNoAl = subName.startsWith('ال') ? subName.substring(2) : subName;
            
            // Direct match
            if (q.includes(subName) || (subNameNoAl.length > 2 && q.includes(subNameNoAl))) {
              targetSubjectId = sub.id;
              break;
            }

            // Fuzzy matches for common exam/study subjects in Arabic
            if (subName.includes('عرب') && (q.includes('عربي') || q.includes('العربية') || q.includes('لغتي'))) {
              targetSubjectId = sub.id;
              break;
            }
            if (subName.includes('رياض') && (q.includes('رياضيات') || q.includes('رياضه') || q.includes('رياضة'))) {
              targetSubjectId = sub.id;
              break;
            }
            if ((subName.includes('نجليز') || subName.includes('english')) && (q.includes('انجليزي') || q.includes('إنجليزي') || q.includes('انقلش') || q.includes('english'))) {
              targetSubjectId = sub.id;
              break;
            }
            if (subName.includes('علوم') && q.includes('علوم')) {
              targetSubjectId = sub.id;
              break;
            }
            if (subName.includes('قرآ') && (q.includes('قران') || q.includes('قرآن') || q.includes('تلاوة'))) {
              targetSubjectId = sub.id;
              break;
            }
            if (subName.includes('توحيد') && q.includes('توحيد')) {
              targetSubjectId = sub.id;
              break;
            }
            if (subName.includes('فقه') && q.includes('فقه')) {
              targetSubjectId = sub.id;
              break;
            }
            if (subName.includes('حديث') && q.includes('حديث')) {
              targetSubjectId = sub.id;
              break;
            }
            if (subName.includes('تفسير') && q.includes('تفسير')) {
              targetSubjectId = sub.id;
              break;
            }
            if (subName.includes('اجتماع') && (q.includes('اجتماعيات') || q.includes('تاريخ') || q.includes('جغرافيا'))) {
              targetSubjectId = sub.id;
              break;
            }
          }
        }

        // 1. Day-based query logic
        if (targetDay !== null && targetDay !== undefined) {
          filteredSchedule = schedule.filter(s => s.day_of_week === targetDay);
          const scheduledSubjectsForDay = filteredSchedule.map(s => s.subject_id);
          
          const today = new Date();
          const currentDay = getISODay(today) - 1;
          let daysToAdd = targetDay - currentDay;
          if (daysToAdd < 0) daysToAdd += 7;
          const targetDate = addDays(today, daysToAdd);
          const targetDateString = format(targetDate, 'yyyy-MM-dd');

          filteredNotes = notes.filter(n => 
            n.note_date === targetDateString || n.day_of_week === targetDay
          );

          filteredTasks = filteredTasks.filter(t => {
            const normalizedDueAt = normalizeDateYYYYMMDD(t.due_at);
            const isDueOnDay = normalizedDueAt === targetDateString;
            const isScheduledSubjectTask = !normalizedDueAt && t.subject_id && scheduledSubjectsForDay.includes(t.subject_id);
            return isDueOnDay || isScheduledSubjectTask;
          });
        } 
        // 2. Subject-based query logic (no day specified)
        else if (targetSubjectId) {
          filteredTasks = filteredTasks.filter(t => t.subject_id === targetSubjectId);
          filteredSchedule = schedule.filter(s => s.subject_id === targetSubjectId);
          if (isSubjectsQuery) {
            filteredSubjects = subjects.filter(s => s.id === targetSubjectId);
          }
        }
        // 3. General query logic (no day, no subject)
        else {
          if (isSubjectsQuery) {
            filteredSubjects = subjects;
          } else if (!isAllTasks && !isImportantOnly && !isProjectsOnly && targetTypes.length === 0) {
             targetDay = getISODay(new Date()) - 1;
             filteredSchedule = schedule.filter(s => s.day_of_week === targetDay);
             const scheduledSubjectsForDay = filteredSchedule.map(s => s.subject_id);
             
             const today = new Date();
             const currentDay = getISODay(today) - 1;
             let daysToAdd = targetDay - currentDay;
             if (daysToAdd < 0) daysToAdd += 7;
             const targetDate = addDays(today, daysToAdd);
             const targetDateString = format(targetDate, 'yyyy-MM-dd');

             filteredNotes = notes.filter(n => 
               n.note_date === targetDateString || n.day_of_week === targetDay
             );

             filteredTasks = filteredTasks.filter(t => {
               const isScheduledSubjectTask = t.subject_id && scheduledSubjectsForDay.includes(t.subject_id);
               const normalizedDueAt = normalizeDateYYYYMMDD(t.due_at);
               const isDueOnDay = normalizedDueAt === targetDateString;
               return isScheduledSubjectTask || isDueOnDay;
             });
          }
          // Else, it's a broad query, keep all undone tasks
        }

        // Apply secondary filters
        if (targetTypes.length > 0) {
          filteredTasks = filteredTasks.filter(t => {
            if (targetTypes.includes(t.type)) return true;
            return targetTypes.some(typeKey => {
              const keywords = typeKeywordsMap[typeKey] || [];
              const taskTitle = (t.title || '').toLowerCase();
              const taskDetails = (t.details || '').toLowerCase();
              return keywords.some(kw => taskTitle.includes(kw) || taskDetails.includes(kw));
            });
          });
        }
        if (isImportantOnly) {
          filteredTasks = filteredTasks.filter(t => t.is_important);
        }
        if (isProjectsOnly) {
          filteredTasks = filteredTasks.filter(t => t.type === 'project' || (t.title || '').toLowerCase().includes('مشروع') || (t.title || '').toLowerCase().includes('مشاريع'));
        }

        // Ultimate Smart Full-Text Search Fallback
        if (filteredTasks.length === 0 && filteredSchedule.length === 0 && filteredNotes.length === 0) {
          const stopWords = ['يا', 'هل', 'من', 'في', 'على', 'عن', 'وش', 'عندي', 'لدي', 'شو', 'ماذا', 'مع', 'أنا', 'انا', 'هو', 'هي', 'بشأن', 'لي', 'عن', 'كان', 'كيف', 'صار', 'يكون', 'ال', 'بكره', 'بكرة', 'بنا'];
          const words = q.split(/[\s,؟?]+/).filter(w => w.length >= 2 && !stopWords.includes(w));
          if (words.length > 0) {
            const keywordMatchedTasks = tasks.filter(t => {
              if (t.is_done) return false;
              const title = (t.title || '').toLowerCase();
              const details = (t.details || '').toLowerCase();
              return words.some(w => title.includes(w) || details.includes(w));
            });
            if (keywordMatchedTasks.length > 0) {
              filteredTasks = keywordMatchedTasks;
            }
          }
        }

        // Determine answer text based on REAL results
        let answerText = "";
        if (filteredTasks.length === 0 && filteredSchedule.length === 0 && filteredNotes.length === 0 && filteredSubjects.length === 0) {
          answerText = "لم أجد نتائج مطابقة في بياناتك. تذكّر أنه يمكنك دائمًا إضافة المهام والتحاضير والمواد لدراستك لتظهر لك هنا!";
        } else {
          if (isSubjectsQuery) {
            if (filteredSubjects.length > 0) {
              answerText = `نعم، وجدتُ لديك ${filteredSubjects.length} من المواد المسجلة! يمكنك رؤيتها بالتفصيل أدناه:`;
            } else {
              answerText = `لم أجد مادة بهذا الاسم مسجلة لديك، ولكن إليك بقية المواد والمهام:`;
            }
          } else if (targetDay !== null) {
            const dayNames = ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
            const todayId = getISODay(new Date()) - 1;
            const tomorrowId = getISODay(new Date()) % 7;
            let dayName = `يوم ${dayNames[targetDay]}`;
            if (targetDay === todayId) dayName = 'اليوم';
            else if (targetDay === tomorrowId) dayName = 'غداً';
            if (filteredTasks.length > 0) {
              answerText = `وجدت ${filteredTasks.length} مهام لك ${dayName}. ستجد التفاصيل أدناه.`;
            } else {
              answerText = `لا توجد مهام، لكن وجدت عناصر في جدولك أو ملاحظاتك ${dayName}. ستجد التفاصيل أدناه.`;
            }
          } else if (targetSubjectId !== null) {
            const subName = subjects.find(s => s.id === targetSubjectId)?.name || '';
            if (filteredTasks.length > 0) {
              answerText = `وجدت ${filteredTasks.length} مهام لمادة ${subName}. ستجد التفاصيل أدناه.`;
            } else {
              answerText = `لا توجد مهام، لكن وجدت عناصر في جدولك أو ملاحظاتك لمادة ${subName}. ستجد التفاصيل أدناه.`;
            }
          } else if (isImportantOnly) {
            answerText = `وجدت ${filteredTasks.length} مهام مهمة. ستجد التفاصيل أدناه.`;
          } else if (isProjectsOnly) {
            answerText = `وجدت ${filteredTasks.length} مشاريع. ستجد التفاصيل أدناه.`;
          } else {
            if (filteredTasks.length > 0) {
               const hasPrep = filteredTasks.some(t => t.type === 'prep' || (t.title || '').toLowerCase().includes('تحضير'));
               if (hasPrep && q.includes('تحضير')) {
                 answerText = `نعم، وجدتُ لك تحضيراً دراسياً! إليك المهام والتحاضير أدناه:`;
               } else {
                 answerText = `وجدت ${filteredTasks.length} مهام. ستجد التفاصيل أدناه.`;
               }
            } else {
              answerText = `لا توجد مهام، لكن وجدت عناصر في جدولك أو ملاحظاتك. ستجد التفاصيل أدناه.`;
            }
          }
        }

        setAiAnswer(data.answer || answerText);
        setResults({
          tasks: filteredTasks,
          schedule: filteredSchedule,
          notes: filteredNotes,
          subjects: filteredSubjects.length > 0 ? filteredSubjects : undefined
        });
      }

    } catch (error: any) {
      console.error("Search Error:", error);
      fallbackSearch();
    } finally {
      setIsLoading(false);
    }
  };

  const fallbackSearch = () => {
    const q = query.toLowerCase();
    
    // Intent detection flags
    let isAllTasks = q.includes('كل المهام') || q.includes('المهام كلها') || q.includes('اعرض المهام');
    let isImportantOnly = q.includes('مهم') || q.includes('مهمة');
    let isProjectsOnly = q.includes('مشروع') || q.includes('مشاريع');
    
    // Simple NLP mapping for days (0=Monday, 6=Sunday)
    const daysMap: Record<string, number> = {
      'الاثنين': 0, 'الإثنين': 0, 'اثنين': 0,
      'الثلاثاء': 1, 'ثلاثاء': 1,
      'الاربعاء': 2, 'الأربعاء': 2, 'اربعاء': 2,
      'الخميس': 3, 'خميس': 3,
      'الجمعة': 4, 'الجمعه': 4, 'جمعة': 4,
      'السبت': 5, 'سبت': 5,
      'الاحد': 6, 'الأحد': 6, 'احد': 6,
      'اليوم': getISODay(new Date()) - 1,
      'غدا': getISODay(new Date()) % 7,
      'غدًا': getISODay(new Date()) % 7,
      'باجر': getISODay(new Date()) % 7,
    };

    const typesMap: Record<string, string> = {
      'تحضير': 'prep', 'تحاضير': 'prep',
      'واجب': 'homework', 'واجبات': 'homework',
      'مشروع': 'project', 'مشاريع': 'project',
      'ملاحظة': 'subject_note', 'ملاحظات': 'subject_note',
    };

    const typeKeywordsMap: Record<string, string[]> = {
      prep: ['تحضير', 'تحاضير', 'أحضر', 'احضر'],
      homework: ['واجب', 'واجبات', 'فرض', 'فروض'],
      project: ['مشروع', 'مشاريع', 'بروجكت', 'البحث', 'بحث'],
      subject_note: ['ملاحظة', 'ملاحظات', 'نوت', 'ملخص', 'ملخصات']
    };

    let targetDay: number | null = null;
    let targetType: string | null = null;
    let targetSubject: string | null = null;
    const isSubjectsQuery = q.includes('مادة') || q.includes('مواد') || q.includes('المسجلة') || q.includes('مسجل') || q.includes('مسجله') || q.includes('المواد');
    let filteredSubjects: Subject[] = [];

    // Detect day
    for (const [key, val] of Object.entries(daysMap)) {
      if (q.includes(key)) {
        targetDay = val;
        break;
      }
    }

    // Detect type
    for (const [key, val] of Object.entries(typesMap)) {
      if (q.includes(key)) {
        targetType = val;
        break;
      }
    }

    // Detect subject with fuzzy matching
    for (const sub of subjects) {
      const subName = sub.name.toLowerCase();
      const subNameNoAl = subName.startsWith('ال') ? subName.substring(2) : subName;
      
      if (q.includes(subName) || (subNameNoAl.length > 2 && q.includes(subNameNoAl))) {
        targetSubject = sub.id;
        break;
      }

      // Fuzzy matching for Arabic subjects
      if (subName.includes('عرب') && (q.includes('عربي') || q.includes('العربية') || q.includes('لغتي'))) {
        targetSubject = sub.id;
        break;
      }
      if (subName.includes('رياض') && (q.includes('رياضيات') || q.includes('رياضه') || q.includes('رياضة'))) {
        targetSubject = sub.id;
        break;
      }
      if ((subName.includes('نجليز') || subName.includes('english')) && (q.includes('انجليزي') || q.includes('إنجليزي') || q.includes('انقلش') || q.includes('english'))) {
        targetSubject = sub.id;
        break;
      }
      if (subName.includes('علوم') && q.includes('علوم')) {
        targetSubject = sub.id;
        break;
      }
      if (subName.includes('قرآ') && (q.includes('قران') || q.includes('قرآن') || q.includes('تلاوة'))) {
        targetSubject = sub.id;
        break;
      }
      if (subName.includes('توحيد') && q.includes('توحيد')) {
        targetSubject = sub.id;
        break;
      }
      if (subName.includes('فقه') && q.includes('فقه')) {
        targetSubject = sub.id;
        break;
      }
      if (subName.includes('حديث') && q.includes('حديث')) {
        targetSubject = sub.id;
        break;
      }
      if (subName.includes('تفسير') && q.includes('تفسير')) {
        targetSubject = sub.id;
        break;
      }
      if (subName.includes('اجتماع') && (q.includes('اجتماعيات') || q.includes('تاريخ') || q.includes('جغرافيا'))) {
        targetSubject = sub.id;
        break;
      }
    }

    let filteredTasks = tasks.filter(t => !t.is_done);
    let filteredSchedule: WeeklySchedule[] = [];
    let filteredNotes: DayNote[] = [];

    // Helper to normalize date
    const normalizeDateYYYYMMDD = (dateStr: string | null | undefined) => {
      if (!dateStr) return null;
      try {
        return format(new Date(dateStr), 'yyyy-MM-dd');
      } catch {
        return null;
      }
    };

    // 1. Day-based query logic
    if (targetDay !== null) {
      filteredSchedule = schedule.filter(s => s.day_of_week === targetDay);
      const scheduledSubjectsForDay = filteredSchedule.map(s => s.subject_id);
      
      const today = new Date();
      const currentDay = getISODay(today) - 1;
      let daysToAdd = targetDay - currentDay;
      if (daysToAdd < 0) daysToAdd += 7;
      const targetDate = addDays(today, daysToAdd);
      const targetDateString = format(targetDate, 'yyyy-MM-dd');

      filteredNotes = notes.filter(n => 
        n.note_date === targetDateString || n.day_of_week === targetDay
      );

      filteredTasks = filteredTasks.filter(t => {
        const normalizedDueAt = normalizeDateYYYYMMDD(t.due_at);
        const isDueOnDay = normalizedDueAt === targetDateString;
        const isScheduledSubjectTask = !normalizedDueAt && t.subject_id && scheduledSubjectsForDay.includes(t.subject_id);
        return isDueOnDay || isScheduledSubjectTask;
      });
    } 
    // 2. Subject-based query logic (no day specified)
    else if (targetSubject !== null) {
      filteredTasks = filteredTasks.filter(t => t.subject_id === targetSubject);
      filteredSchedule = schedule.filter(s => s.subject_id === targetSubject);
      if (isSubjectsQuery) {
        filteredSubjects = subjects.filter(s => s.id === targetSubject);
      }
    }
    // 3. General query logic (no day, no subject)
    else {
      if (isSubjectsQuery) {
        filteredSubjects = subjects;
      } else if (!isAllTasks && !isImportantOnly && !isProjectsOnly && !targetType) {
         targetDay = getISODay(new Date()) - 1;
         filteredSchedule = schedule.filter(s => s.day_of_week === targetDay);
         const scheduledSubjectsForDay = filteredSchedule.map(s => s.subject_id);
         
         const startOfCurrentWeek = startOfWeek(new Date(), { weekStartsOn: 1 });
         const targetDate = addDays(startOfCurrentWeek, targetDay);
         const targetDateString = format(targetDate, 'yyyy-MM-dd');

         filteredNotes = notes.filter(n => 
           n.note_date === targetDateString || n.day_of_week === targetDay
         );

         filteredTasks = filteredTasks.filter(t => {
           const isScheduledSubjectTask = t.subject_id && scheduledSubjectsForDay.includes(t.subject_id);
           const normalizedDueAt = normalizeDateYYYYMMDD(t.due_at);
           const isDueOnDay = normalizedDueAt === targetDateString;
           return isScheduledSubjectTask || isDueOnDay;
         });
      }
      // Else, it's a broad query, keep all undone tasks
    }

    // Apply secondary filters
    if (targetType) {
      filteredTasks = filteredTasks.filter(t => {
        if (t.type === targetType) return true;
        const keywords = typeKeywordsMap[targetType] || [];
        const taskTitle = (t.title || '').toLowerCase();
        const taskDetails = (t.details || '').toLowerCase();
        return keywords.some(kw => taskTitle.includes(kw) || taskDetails.includes(kw));
      });
    }
    if (isImportantOnly) {
      filteredTasks = filteredTasks.filter(t => t.is_important);
    }
    if (isProjectsOnly) {
      filteredTasks = filteredTasks.filter(t => t.type === 'project' || (t.title || '').toLowerCase().includes('مشروع') || (t.title || '').toLowerCase().includes('مشاريع'));
    }

    // Smart Full-Text Search Fallback
    if (filteredTasks.length === 0 && filteredSchedule.length === 0 && filteredNotes.length === 0) {
      const stopWords = ['يا', 'هل', 'من', 'في', 'على', 'عن', 'وش', 'عندي', 'لدي', 'شو', 'ماذا', 'مع', 'أنا', 'انا', 'هو', 'هي', 'بشأن', 'لي', 'عن', 'كان', 'كيف', 'صار', 'يكون', 'ال', 'بكره', 'بكرة', 'بنا'];
      const words = q.split(/[\s,؟?]+/).filter(w => w.length >= 2 && !stopWords.includes(w));
      if (words.length > 0) {
        const keywordMatchedTasks = tasks.filter(t => {
          if (t.is_done) return false;
          const title = (t.title || '').toLowerCase();
          const details = (t.details || '').toLowerCase();
          return words.some(w => title.includes(w) || details.includes(w));
        });
        if (keywordMatchedTasks.length > 0) {
          filteredTasks = keywordMatchedTasks;
        }
      }
    }

    // Determine answer text
    let answerText = "";
    if (filteredTasks.length === 0 && filteredSchedule.length === 0 && filteredNotes.length === 0 && filteredSubjects.length === 0) {
      answerText = "لم أجد نتائج مطابقة في بياناتك. تذكّر أنه يمكنك دائمًا إضافة المهام والتحاضير من القوائم الجانبية لتظهر لك هنا!";
    } else {
      if (isSubjectsQuery) {
        if (filteredSubjects.length > 0) {
          answerText = `نعم، وجدتُ لديك ${filteredSubjects.length} من المواد المسجلة! يمكنك رؤيتها بالتفصيل أدناه:`;
        } else {
          answerText = `لم أجد مادة بهذا الاسم مسجلة لديك، ولكن إليك بقية المواد والمهام:`;
        }
      } else if (targetDay !== null) {
        const dayNames = ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
        const todayId = getISODay(new Date()) - 1;
        const tomorrowId = getISODay(new Date()) % 7;
        let dayName = `يوم ${dayNames[targetDay]}`;
        if (targetDay === todayId) dayName = 'اليوم';
        else if (targetDay === tomorrowId) dayName = 'غداً';
        if (filteredTasks.length > 0) {
          answerText = `وجدت ${filteredTasks.length} مهام لك ${dayName}. ستجد التفاصيل أدناه.`;
        } else {
          answerText = `لا توجد مهام، لكن وجدت عناصر في جدولك أو ملاحظاتك ${dayName}. ستجد التفاصيل أدناه.`;
        }
      } else if (targetSubject !== null) {
        const subName = subjects.find(s => s.id === targetSubject)?.name || '';
        if (filteredTasks.length > 0) {
          answerText = `وجدت ${filteredTasks.length} مهام لمادة ${subName}. ستجد التفاصيل أدناه.`;
        } else {
          answerText = `لا توجد مهام، لكن وجدت عناصر في جدولك أو ملاحظاتك لمادة ${subName}. ستجد التفاصيل أدناه.`;
        }
      } else if (isImportantOnly) {
        answerText = `وجدت ${filteredTasks.length} مهام مهمة. ستجد التفاصيل أدناه.`;
      } else if (isProjectsOnly) {
        answerText = `وجدت ${filteredTasks.length} مشاريع. ستجد التفاصيل أدناه.`;
      } else {
        if (filteredTasks.length > 0) {
           const hasPrep = filteredTasks.some(t => t.type === 'prep' || (t.title || '').toLowerCase().includes('تحضير'));
           if (hasPrep && q.includes('تحضير')) {
             answerText = `نعم، وجدتُ لك تحضيراً دراسياً! إليك المهام والتحاضير أدناه:`;
           } else {
             answerText = `وجدت ${filteredTasks.length} مهام. ستجد التفاصيل أدناه.`;
           }
        } else {
          answerText = `لا توجد مهام، لكن وجدت عناصر في جدولك أو ملاحظاتك. ستجد التفاصيل أدناه.`;
        }
      }
    }

    setAiAnswer(answerText);
    setResults({
      tasks: filteredTasks,
      schedule: filteredSchedule,
      notes: filteredNotes,
      subjects: filteredSubjects.length > 0 ? filteredSubjects : undefined
    });
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Local Toast Alert */}
      {localToast && (
        <div className={`flex items-center gap-2 rounded-xl p-4 text-sm font-medium transition-all ${localToast.isError ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-green-500/10 text-green-500 border border-green-500/20'}`}>
          {localToast.isError ? <AlertTriangle className="h-5 w-5 shrink-0" /> : <CheckCircle className="h-5 w-5 shrink-0" />}
          <span>{localToast.message}</span>
        </div>
      )}

      <div className="flex flex-col items-center justify-center py-6 text-center">
        <div className="mb-4 rounded-full bg-[var(--primary)]/10 p-4 text-[var(--primary)]">
          <Sparkles className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-bold text-[var(--text)]">اسأل المساعد الذكي</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          اكتب سؤالك باللغة العربية، مثل: "ماذا لدي غداً؟" أو "هل لدي واجبات في الرياضيات؟"
        </p>
      </div>

      {/* API Key Configuration Card */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
        {!showKeyForm && apiKey ? (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4" dir="rtl">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-green-500/10 p-2 text-green-500">
                <CheckCircle className="h-5 w-5" />
              </div>
              <div className="text-right">
                <h4 className="font-bold text-sm text-[var(--text)]">مساعد الذكاء الاصطناعي نشط ومفعل</h4>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  النموذج المستخدم: <span className="font-mono bg-[var(--surface)] px-1.5 py-0.5 rounded text-[var(--primary)]">{selectedModel}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowKeyForm(true)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] transition cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                تعديل الإعدادات
              </button>
              <button
                onClick={handleDeleteKey}
                className="flex items-center gap-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 px-3 py-1.5 text-xs font-semibold transition cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                حذف المفتاح
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4" dir="rtl">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-[var(--primary)]/10 p-2.5 text-[var(--primary)] mt-0.5">
                <Key className="h-5 w-5 animate-pulse" />
              </div>
              <div className="text-right flex-1">
                <h4 className="font-bold text-sm text-[var(--text)]">تكوين إعدادات مفتاح الذكاء الاصطناعي (Gemini)</h4>
                <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed">
                  الذكاء الاصطناعي يتطلب إضافة مفاتيح API الخاصة بك من Google AI Studio لتتمكن من تشغيل الاستفسارات بمرونة تامة وتحليل ذكي لمهامك وجدولك.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 pt-2">
              <div>
                <label className="block text-xs font-bold text-[var(--text)] mb-1.5 text-right">اختر نموذج Gemini:</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full text-right rounded-xl border border-[var(--border)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none cursor-pointer"
                >
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash (موصى به - فائق السرعة)</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro (ذكي - فائق الدقة والاستنتاج)</option>
                  <option value="gemini-3.5-flash">Gemini 3.5 Flash (الجيل الجديد - فائق السرعة والذكاء)</option>
                  <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (خفيف وسريع جداً)</option>
                  <option value="gemini-flash-latest">Gemini Flash Latest (الجيل الأحدث المستقر)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--text)] mb-1.5 text-right">مفتاح API الخاص بك:</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full text-left rounded-xl border border-[var(--border)] bg-[var(--bg2)] pl-10 pr-3 py-2 text-sm font-mono text-[var(--text)] focus:border-[var(--primary)] focus:outline-none"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-[var(--border)]/50 mt-1">
              <a
                href="https://aistudio.google.com/"
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                className="flex items-center gap-1 text-xs text-[var(--primary)] hover:underline font-semibold"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                احصل على مفتاح Gemini API مجاني من Google AI Studio
              </a>

              <div className="flex items-center gap-2">
                {apiKey && (
                  <button
                    onClick={() => setShowKeyForm(false)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-1.5 text-xs font-bold text-[var(--text)] hover:bg-[var(--surface)] transition cursor-pointer"
                  >
                    إلغاء
                  </button>
                )}
                <button
                  onClick={handleSaveKey}
                  className="rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] px-5 py-1.5 text-xs font-bold transition shadow-sm cursor-pointer"
                >
                  حفظ وتفعيل
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSearch} className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="اسأل هنا..."
          disabled={isLoading}
          className="w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] py-4 pl-14 pr-6 text-lg shadow-sm focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 disabled:opacity-70 text-right"
          dir="rtl"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="absolute left-3 top-1/2 -translate-y-1/2 rounded-xl bg-[var(--primary)] p-2 text-white hover:bg-[var(--primary)]/90 disabled:opacity-70 cursor-pointer"
        >
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 rotate-180" />}
        </button>
      </form>

      {aiAnswer && (
        <div className="rounded-2xl bg-[var(--primary)]/10 border border-[var(--primary)]/20 p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="mt-1 rounded-full bg-[var(--primary)]/20 p-2 text-[var(--primary)]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--primary)] mb-1">المساعد الذكي</h3>
              <p className="text-[var(--text)] leading-relaxed whitespace-pre-wrap">{aiAnswer}</p>
            </div>
          </div>
        </div>
      )}

      {results && (
        <div className="space-y-6 pt-2">
          <h3 className="text-lg font-semibold text-[var(--text)] border-b border-[var(--border)] pb-2">
            نتائج البحث
          </h3>

          {results.subjects && results.subjects.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-medium text-[var(--text)]">المواد المسجلة</h4>
              <div className="flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
                {results.subjects.map(s => (
                  <span key={s.id} className="rounded-lg px-3 py-1.5 text-sm font-medium text-white shadow-sm" style={{ backgroundColor: s.color }}>
                    {s.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {results.schedule.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-medium text-[var(--text)]">الجدول الدراسي</h4>
              <div className="flex flex-wrap gap-2">
                {results.schedule.map(s => {
                  const sub = subjectMap[s.subject_id];
                  return sub ? (
                    <span key={s.id} className="rounded-lg px-3 py-1.5 text-sm font-medium text-white" style={{ backgroundColor: sub.color }}>
                      {sub.name}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          )}

          {results.tasks.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-medium text-[var(--text)]">المهام</h4>
              <div className="grid gap-4">
                {results.tasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    subject={task.subject_id ? subjectMap[task.subject_id] : undefined}
                    onToggleDone={handleToggleDone}
                    onToggleImportant={handleToggleImportant}
                    onDelete={handleDeleteTask}
                    onEdit={(t) => {
                      setEditingTask(t);
                      setIsTaskDialogOpen(true);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {results.notes.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-medium text-[var(--text)]">الملاحظات</h4>
              <div className="grid gap-4">
                {results.notes.map(note => (
                  <div key={note.id} className="rounded-xl border border-[var(--border)] bg-amber-50/50 p-4">
                    {note.title && <h5 className="font-semibold text-[var(--text)] mb-1">{note.title}</h5>}
                    <p className="text-sm text-[var(--text-secondary)]">{note.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results.tasks.length === 0 && results.schedule.length === 0 && results.notes.length === 0 && (!results.subjects || results.subjects.length === 0) && (
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] py-12 text-center">
              <p className="text-[var(--muted)]">لم يتم العثور على نتائج مطابقة لسؤالك.</p>
            </div>
          )}
        </div>
      )}

      <TaskDialog
        isOpen={isTaskDialogOpen}
        onClose={() => setIsTaskDialogOpen(false)}
        onSubmit={handleTaskSubmit}
        initialData={editingTask}
        subjects={subjects}
      />
    </div>
  );
}

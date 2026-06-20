import { useState } from 'react';
import { MoreVertical, Calendar as CalendarIcon, Star, CheckCircle, Circle, Trash2, Edit2, CalendarDays } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { Task, Subject } from '../lib/db';
import SyncBadge from './SyncBadge';
import { cn, sanitizeDetails } from '../lib/utils';

interface TaskCardProps {
  task: Task;
  subject?: Subject;
  onToggleDone: (id: string, isDone: boolean) => void;
  onToggleImportant: (id: string, isImportant: boolean) => void;
  onDelete: (id: string) => void;
  onEdit: (task: Task) => void;
}

export default function TaskCard({ task, subject, onToggleDone, onToggleImportant, onDelete, onEdit }: TaskCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  
  const isTeacherAssigned = task.details && task.details.includes('👨‍🏫 تم إسناد هذا بواسطة');
  let teacherName = '';
  if (isTeacherAssigned) {
    const match = task.details.match(/👨‍🏫 تم إسناد هذا بواسطة الدكتور\/المعلم: ([^\n]*)/);
    if (match && match[1]) {
      teacherName = match[1].trim();
    }
  }

  let renderDetails = sanitizeDetails(task.details);
  if (isTeacherAssigned) {
    // Strip the signature so it doesn't double-render inside details paragraph
    renderDetails = renderDetails.replace(/👨‍🏫 تم إسناد هذا بواسطة الدكتور\/المعلم: [^\n]*\n*/, '').trim();
  }

  const typeLabels = {
    prep: 'تحضير',
    homework: 'واجب',
    project: 'مشروع',
    subject_note: 'ملاحظة'
  };

  return (
    <div className={cn(
      "relative flex flex-col gap-3 rounded-xl border p-4 shadow-sm transition-all animate-in fade-in duration-300",
      task.is_done ? "border-[var(--border)] bg-[var(--surface)] opacity-75" : "border-[var(--border)] bg-[var(--card)]",
      task.is_important && !task.is_done ? "border-[var(--primary)] bg-[var(--primary)]/10 animate-pulse-slow" : ""
    )}>
      {isTeacherAssigned && (
        <div className="flex items-center gap-2 rounded-lg bg-[var(--primary)]/5 px-2.5 py-1 text-[11px] font-bold text-[var(--primary)] border border-[var(--primary)]/10">
          <span>👨‍🏫</span>
          <span>تكليف رسمي من د./أ. {teacherName || 'المعلم'}</span>
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            onClick={() => onToggleDone(task.id, !task.is_done)}
            className={cn(
              "mt-0.5 flex-shrink-0 rounded-full transition-colors",
              task.is_done ? "text-emerald-500" : "text-[var(--muted)] hover:text-[var(--primary)]"
            )}
          >
            {task.is_done ? <CheckCircle className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
          </button>
          
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={cn("font-semibold text-[var(--text)]", task.is_done && "line-through text-[var(--muted)]")}>
                {task.title || ''}
              </h3>
              {task.is_important && <Star className="h-4 w-4 fill-[var(--primary)] text-[var(--primary)]" />}
            </div>
            
            <div className="flex items-center gap-2 text-xs font-medium">
              <span className="rounded-md bg-[var(--surface)] px-2 py-0.5 text-[var(--muted)]">
                {(task.type && typeLabels[task.type as keyof typeof typeLabels]) || task.type || 'مهمة'}
              </span>
              {subject && (
                <span 
                  className="rounded-md px-2 py-0.5 text-white"
                  style={{ backgroundColor: subject.color || '#6366f1' }}
                >
                  {subject.name}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="rounded-full p-1 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text-secondary)]"
          >
            <MoreVertical className="h-5 w-5" />
          </button>

          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg">
                <button
                  onClick={() => { setShowMenu(false); onEdit(task); }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--surface)]"
                >
                  <Edit2 className="h-4 w-4" />
                  تعديل النص
                </button>
                <button
                  onClick={() => { setShowMenu(false); onEdit(task); }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--surface)]"
                >
                  <CalendarDays className="h-4 w-4" />
                  تعديل التاريخ
                </button>
                <button
                  onClick={() => { setShowMenu(false); onToggleImportant(task.id, !task.is_important); }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--surface)]"
                >
                  <Star className="h-4 w-4" />
                  {task.is_important ? 'غير مهم' : 'مهم ⭐'}
                </button>
                <button
                  onClick={() => { setShowMenu(false); onDelete(task.id); }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                  حذف
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {renderDetails.length > 0 && (
        <p className={cn("text-sm text-[var(--text-secondary)] line-clamp-2 whitespace-pre-line break-words", task.is_done && "text-[var(--muted)]")}>
          {renderDetails}
        </p>
      )}

      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-4 text-xs text-[var(--muted)]">
          {task.due_at && (() => {
            try {
              const d = new Date(task.due_at);
              if (isNaN(d.getTime())) return <span className="text-red-400">Invalid Date</span>;
              return (
                <div className="flex items-center gap-1">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  <span dir="ltr">{format(d, 'MMM d, yyyy', { locale: ar })}</span>
                </div>
              );
            } catch (e) {
              return <span className="text-red-400">Date Error</span>;
            }
          })()}
        </div>
        <SyncBadge status={task.sync_status} />
      </div>
    </div>
  );
}

import { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { ensureAppDataLoaded } from '../lib/appDataLoader';
import { db } from '../lib/db';
import { migrateDayOfWeekToMondayFirst } from '../lib/localMigrations';
import { isNetworkError } from '../lib/sync';

interface AuthContextType {
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          const errMsg = error.message || '';
          if (
            errMsg.includes('Refresh Token') || 
            errMsg.includes('refresh_token') || 
            errMsg.includes('not found') || 
            error.status === 400
          ) {
            console.warn('Invalid refresh token detected during session recovery. Clearing bad session storage window...', errMsg);
            await supabase.auth.signOut().catch(() => {});
            if (mounted) {
              setUser(null);
            }
            return;
          }
          throw error;
        }
        
        if (mounted) {
          const currentUser = session?.user ?? null;
          setUser(currentUser);
          
          // Non-blocking data load
          if (currentUser) {
            migrateDayOfWeekToMondayFirst(currentUser.id).catch(err => console.error('Migration failed:', err));
            
            // Check if we need to force sync (e.g. if subjects are empty)
            db.subjects.where('user_id').equals(currentUser.id).count().then(count => {
              // ensureAppDataLoaded now uses SyncController which handles locking
              // We force sync if count is 0 to ensure data is fetched
              ensureAppDataLoaded(currentUser.id, { force: count === 0 }).catch(err => 
                console.error('Background data load failed:', err)
              );
            }).catch(err => {
              console.error('Failed to count subjects:', err);
              // Fallback: try to sync anyway if DB fails
              ensureAppDataLoaded(currentUser.id, { force: false }).catch(e => console.error(e));
            });
          }
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err || '');
        if (
          errMsg.includes('Refresh Token') || 
          errMsg.includes('refresh_token') || 
          errMsg.includes('not found')
        ) {
          console.warn('Exception with invalid refresh token, force-clearing session:', errMsg);
          await supabase.auth.signOut().catch(() => {});
          if (mounted) {
            setUser(null);
          }
        } else if (isNetworkError(err)) {
          console.warn('Auth init network error (offline?):', err?.message || String(err));
        } else {
          console.error('Auth init failed:', err);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    // Safety timeout to prevent infinite loading
    const timeoutId = setTimeout(() => {
      if (mounted && loading) {
        console.warn('Auth init timed out, forcing loading false');
        setLoading(false);
      }
    }, 5000);

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (mounted) {
        const currentUser = session?.user ?? null;
        setUser(currentUser);
        
        // Non-blocking data load on auth change
        if (currentUser) {
          // Sync current logged in user to student_profiles
          const profileName = currentUser.user_metadata?.name || currentUser.email?.split('@')[0] || 'مستخدم';
          const profileRole = currentUser.user_metadata?.role || 'student';
          
          // Upsert to Supabase
          supabase.from('student_profiles').upsert({
            id: currentUser.id,
            email: currentUser.email || '',
            name: profileName,
            role: profileRole,
            created_at: new Date().toISOString()
          }).then(({ error }) => {
            if (error) {
              console.error('Failed to upsert student profile to Supabase on AuthChange:', error);
            }
          });

          db.student_profiles.put({
            id: currentUser.id,
            email: currentUser.email || '',
            name: profileName,
            role: profileRole,
            created_at: new Date().toISOString()
          }).catch(err => console.error('Failed to write student profile:', err));

          migrateDayOfWeekToMondayFirst(currentUser.id).catch(err => console.error('Migration failed:', err));
          
          db.subjects.where('user_id').equals(currentUser.id).count().then(count => {
            ensureAppDataLoaded(currentUser.id, { force: count === 0 }).catch(err => 
              console.error('Background data load failed on auth change:', err)
            );
          });
        }
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

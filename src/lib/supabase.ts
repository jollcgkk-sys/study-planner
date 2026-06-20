import { createClient } from '@supabase/supabase-js';

// Load variables with fallback placeholders to make the app robust in standalone/developer mode
const rawSupabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://placeholder-disabled.supabase.co';
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

// Sanitize URL: Remove trailing slash, /rest/v1, /auth/v1, /graphql/v1 etc.
let sanitizedSupabaseUrl = rawSupabaseUrl.trim();
while (sanitizedSupabaseUrl.endsWith('/')) {
  sanitizedSupabaseUrl = sanitizedSupabaseUrl.slice(0, -1);
}
if (sanitizedSupabaseUrl.endsWith('/rest/v1')) {
  sanitizedSupabaseUrl = sanitizedSupabaseUrl.slice(0, -8);
} else if (sanitizedSupabaseUrl.endsWith('/auth/v1')) {
  sanitizedSupabaseUrl = sanitizedSupabaseUrl.slice(0, -8);
} else if (sanitizedSupabaseUrl.endsWith('/graphql/v1')) {
  sanitizedSupabaseUrl = sanitizedSupabaseUrl.slice(0, -11);
}
while (sanitizedSupabaseUrl.endsWith('/')) {
  sanitizedSupabaseUrl = sanitizedSupabaseUrl.slice(0, -1);
}

const supabaseUrl = sanitizedSupabaseUrl;

const isPlaceholderUrl = 
  !supabaseUrl || 
  supabaseUrl === 'https://placeholder-disabled.supabase.co' || 
  supabaseUrl.includes('YOUR_SUPABASE_URL') || 
  !supabaseUrl.startsWith('http');

if (isPlaceholderUrl) {
  console.warn('[Supabase] Application is running in standalone local/offline-first mode. Supabase features are disabled.');
}

const customLock = async (name: string, acquireTimeout: number, fn: () => Promise<any>) => {
  return await fn();
};

const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof input === 'string' 
    ? input 
    : (input instanceof URL) 
      ? input.toString() 
      : (input && (input as any).url) 
        ? (input as any).url 
        : '';

  const getErrorResponsePayload = (url: string, msg: string) => {
    const lowercaseUrl = url.toLowerCase();
    
    if (lowercaseUrl.includes('/auth/v1/')) {
      return {
        error: 'offline_mode',
        error_description: msg,
        msg: msg
      };
    }
    
    if (lowercaseUrl.includes('/rest/v1/')) {
      return {
        message: msg,
        code: 'OFFLINE_MODE',
        details: 'The database is currently unreachable or running in local offline-first mode.',
        hint: 'Verify internet connection or check Supabase setup.'
      };
    }
    
    if (lowercaseUrl.includes('/functions/v1/')) {
      return {
        error: msg
      };
    }
    
    return {
      error: {
        message: msg,
        status: 503,
        code: 'OFFLINE_MODE'
      },
      message: msg,
      error_description: msg
    };
  };

  if (isPlaceholderUrl) {
    const payload = getErrorResponsePayload(urlStr, 'Supabase parameters are not configured in environment');
    return new Response(
      JSON.stringify(payload),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    // Merge existing signal if provided in init
    let mergedSignal = controller.signal;
    if (init && init.signal) {
      const originalSignal = init.signal;
      originalSignal.addEventListener('abort', () => {
        controller.abort();
      });
      if (originalSignal.aborted) {
        controller.abort();
      }
    }

    const response = await fetch(input, {
      ...init,
      signal: mergedSignal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err: any) {
    if (err && err.name === 'AbortError') {
      console.warn('[Supabase Fetch Interceptor] Request timed out after 12s:', urlStr);
      const payload = getErrorResponsePayload(urlStr, 'Network request timed out');
      return new Response(
        JSON.stringify(payload),
        {
          status: 504,
          statusText: 'Gateway Timeout',
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    console.warn('[Supabase Fetch Interceptor] Intercepted network error:', err);
    // Return a structured 503 error instead of throwing/re-throwing
    const errMsg = err?.message || 'Network request failed';
    const payload = getErrorResponsePayload(urlStr, errMsg);
    return new Response(
      JSON.stringify(payload),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // @ts-ignore
    lock: customLock
  },
  global: {
    fetch: customFetch
  }
});

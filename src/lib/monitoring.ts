import * as Sentry from '@sentry/node';
import { createClient } from '@supabase/supabase-js';

// Lazily load environment variables in case they aren't loaded yet
const getSupabase = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
};

export function initMonitoring() {
  const dsn = process.env.SENTRY_DSN;
  if (dsn) {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 1.0,
    });
    console.log('⚡ Sentry initialized.');
  } else {
    console.log('ℹ️ Sentry DSN not found, skipping Sentry initialization.');
  }
}

export async function pingHealthcheck(checkIdOrUrl: string | undefined, status: 'start' | 'fail' | 'success' = 'success', message?: string) {
  if (!checkIdOrUrl) return;
  
  let url = checkIdOrUrl;
  // If it's just a UUID, format it
  if (!url.startsWith('http')) {
    url = `https://hc-ping.com/${checkIdOrUrl}`;
  }
  
  if (status === 'start') {
    url = `${url}/start`;
  } else if (status === 'fail') {
    url = `${url}/fail`;
  }
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: message || '',
      headers: {
        'Content-Type': 'text/plain'
      }
    });
    if (!res.ok) {
      console.warn(`[WARNING] HEALTHCHECK_PING_FAILED: vérifier l'UUID dans les variables d'env (status: ${res.status} ${res.statusText})`);
    }
  } catch (err: any) {
    console.warn(`Healthcheck ping failed to fetch: ${err.message}`);
  }
}

export async function logStart(scriptName: string, healthcheckId?: string) {
  console.log(`[START] Running ${scriptName}...`);
  if (healthcheckId) {
    await pingHealthcheck(healthcheckId, 'start');
  }
  
  const supabase = getSupabase();
  if (supabase) {
    try {
      await supabase.from('pipeline_logs').insert({
        pipeline_name: scriptName,
        status: 'running',
        run_at: new Date().toISOString()
      });
    } catch (err: any) {
      console.error(`Failed to log start to DB: ${err.message}`);
    }
  }
}

export async function logSuccess(scriptName: string, itemsCount: number = 0, healthcheckId?: string, message?: string) {
  console.log(`[SUCCESS] ${scriptName} completed. Items processed: ${itemsCount}`);
  if (healthcheckId) {
    await pingHealthcheck(healthcheckId, 'success', message || `Processed ${itemsCount} items.`);
  }
  
  const supabase = getSupabase();
  if (supabase) {
    try {
      await supabase.from('pipeline_logs').insert({
        pipeline_name: scriptName,
        status: 'success',
        items_processed: itemsCount,
        run_at: new Date().toISOString()
      });
    } catch (err: any) {
      console.error(`Failed to log success to DB: ${err.message}`);
    }
  }
}

export async function logError(scriptName: string, error: any, healthcheckId?: string) {
  const errMsg = error?.stack || error?.message || String(error);
  console.error(`[ERROR] ${scriptName} failed:`, errMsg);
  
  Sentry.captureException(error, {
    tags: { script: scriptName }
  });
  
  if (healthcheckId) {
    await pingHealthcheck(healthcheckId, 'fail', errMsg);
  }
  
  const supabase = getSupabase();
  if (supabase) {
    try {
      await supabase.from('pipeline_logs').insert({
        pipeline_name: scriptName,
        status: 'error',
        error_details: errMsg,
        run_at: new Date().toISOString()
      });
    } catch (err: any) {
      console.error(`Failed to log error to DB: ${err.message}`);
    }
  }
}

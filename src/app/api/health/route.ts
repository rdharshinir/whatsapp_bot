import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createServerSupabaseClient } from '@/lib/supabase';

export async function GET() {
  const results: Record<string, any> = {
    timestamp: new Date().toISOString(),
    checks: {},
  };

  // 1. Check env vars
  const envChecks = {
    OPENROUTER_API_KEY: !!process.env.OPENROUTER_API_KEY,
    AI_MODEL: process.env.AI_MODEL || 'NOT SET',
    WHATSAPP_ACCESS_TOKEN: !!process.env.WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: !!process.env.WHATSAPP_PHONE_NUMBER_ID,
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    QSTASH_TOKEN: !!process.env.QSTASH_TOKEN,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'NOT SET',
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL || 'NOT SET',
  };
  results.checks.envVars = envChecks;

  // 2. Test Groq/AI connection
  try {
    const openai = new OpenAI({
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey: process.env.OPENROUTER_API_KEY || 'missing',
    });

    const model = process.env.AI_MODEL || 'llama-3.3-70b-versatile';
    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Say "OK" and nothing else.' }],
      max_tokens: 10,
    });

    results.checks.groqAI = {
      status: 'OK',
      model,
      reply: response.choices[0]?.message?.content,
    };
  } catch (error: any) {
    results.checks.groqAI = {
      status: 'FAILED',
      error: error.message,
      statusCode: error.status,
      code: error.code,
    };
  }

  // 3. Test Supabase connection
  try {
    const supabase = createServerSupabaseClient();
    const { count, error } = await supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;
    results.checks.supabase = { status: 'OK', conversationCount: count };
  } catch (error: any) {
    results.checks.supabase = {
      status: 'FAILED',
      error: error.message,
    };
  }

  // Overall status
  const allOk = Object.values(results.checks).every(
    (c: any) => c.status === 'OK' || typeof c === 'object' && !c.status
  );
  results.overall = allOk ? 'HEALTHY' : 'ISSUES_DETECTED';

  return NextResponse.json(results, { status: allOk ? 200 : 503 });
}

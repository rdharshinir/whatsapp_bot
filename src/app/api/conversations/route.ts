import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

export async function GET() {
  const supabase = createServerSupabaseClient();

  // Get all conversations with their latest message
  const { data: conversations, error } = await supabase
    .from('conversations')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching conversations:', error);
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 });
  }

  // Get the last message, appointments, and followups for each conversation
  const conversationsWithData = await Promise.all(
    (conversations || []).map(async (conv) => {
      // 1. Last message
      const { data: lastMsg } = await supabase
        .from('messages')
        .select('content, created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // 2. Upcoming appointment
      const { data: apt } = await supabase
        .from('appointments')
        .select('service_type, scheduled_start')
        .eq('conversation_id', conv.id)
        .eq('status', 'scheduled')
        .gte('scheduled_start', new Date().toISOString())
        .order('scheduled_start', { ascending: true })
        .limit(1)
        .single();

      // 3. Pending followup
      const { data: followup } = await supabase
        .from('followups')
        .select('followup_type, trigger_time')
        .eq('conversation_id', conv.id)
        .eq('status', 'scheduled')
        .order('trigger_time', { ascending: true })
        .limit(1)
        .single();

      return {
        ...conv,
        last_message: lastMsg?.content || null,
        last_message_at: lastMsg?.created_at || conv.updated_at,
        status: apt ? 'scheduled' : 'lead',
        next_appointment: apt ? { service: apt.service_type, start: apt.scheduled_start } : null,
        pending_followup: followup ? { type: followup.followup_type, trigger_time: followup.trigger_time } : null,
      };
    })
  );

  return NextResponse.json(conversationsWithData);
}

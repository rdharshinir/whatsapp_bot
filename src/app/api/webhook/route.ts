import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { getAIResponse } from '@/lib/ai';
import { MetaWebhookPayload } from '@/lib/types';

// GET — Webhook verification
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook verified successfully');
    return new NextResponse(challenge, { status: 200 });
  }

  console.error('Webhook verification failed');
  return new NextResponse('Forbidden', { status: 403 });
}

// POST — Incoming messages
export async function POST(request: NextRequest) {
  try {
    const body: MetaWebhookPayload = await request.json();

    // Debug logging — see exactly what Meta sends
    console.log('=== WEBHOOK POST RECEIVED ===');
    console.log('Body:', JSON.stringify(body, null, 2));

    // Validate it's a WhatsApp message event
    if (body.object !== 'whatsapp_business_account') {
      console.log('Not a WhatsApp event, object:', body.object);
      return NextResponse.json({ error: 'Not a WhatsApp event' }, { status: 400 });
    }

    // Process each entry
    for (const entry of body.entry) {
      for (const change of entry.changes) {
        const value = change.value;

        // Skip status updates, only process messages
        if (!value.messages || value.messages.length === 0) {
          continue;
        }

        for (const message of value.messages) {
          // Only handle text messages for now
          if (message.type !== 'text' || !message.text?.body) {
            continue;
          }

          const phone = message.from;
          const text = message.text.body;
          const whatsappMsgId = message.id;
          const contactName =
            value.contacts?.[0]?.profile?.name || null;

          // Fire and forget so we can return 200 OK to Meta immediately without timing out
          processIncomingMessage(
            phone,
            text,
            whatsappMsgId,
            contactName
          ).catch((err) => console.error('Failed to process message in background:', err));
        }
      }
    }

    // Always return 200 quickly to Meta
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook error:', error);
    // Still return 200 to avoid Meta retries
    return NextResponse.json({ status: 'error' }, { status: 200 });
  }
}

import { scheduleFollowup, cancelFollowup } from '@/lib/qstash';

async function processIncomingMessage(
  phone: string,
  text: string,
  whatsappMsgId: string,
  contactName: string | null
) {
  const supabase = createServerSupabaseClient();

  // Check for duplicate message
  const { data: existingMsg } = await supabase
    .from('messages')
    .select('id')
    .eq('whatsapp_msg_id', whatsappMsgId)
    .single();

  if (existingMsg) {
    console.log('Duplicate message, skipping:', whatsappMsgId);
    return;
  }

  // Find or create conversation
  let { data: conversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!conversation) {
    const { data: newConv, error } = await supabase
      .from('conversations')
      .insert({
        phone,
        name: contactName,
        mode: 'agent',
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating conversation:', error);
      return;
    }
    conversation = newConv;
  } else if (contactName && !conversation.name) {
    // Update name if we didn't have it
    await supabase
      .from('conversations')
      .update({ name: contactName })
      .eq('id', conversation.id);
  }

  // Store user message
  const { error: msgError } = await supabase.from('messages').insert({
    conversation_id: conversation.id,
    role: 'user',
    content: text,
    whatsapp_msg_id: whatsappMsgId,
  });

  if (msgError) {
    console.error('Error storing message:', msgError);
    return;
  }

  // Cancel any pending 'nurture_cold_lead' followups since the user just replied
  const { data: pendingFollowups } = await supabase
    .from('followups')
    .select('*')
    .eq('conversation_id', conversation.id)
    .eq('followup_type', 'nurture_cold_lead')
    .eq('status', 'scheduled');

  if (pendingFollowups && pendingFollowups.length > 0) {
    for (const f of pendingFollowups) {
      if (f.qstash_message_id) {
        try {
          await cancelFollowup(f.qstash_message_id);
        } catch (e) {
          console.error('Error cancelling QStash message:', e);
        }
      }
      await supabase
        .from('followups')
        .update({ status: 'cancelled' })
        .eq('id', f.id);
    }
  }

  // Update conversation timestamp
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversation.id);

  // Check mode — only auto-reply in agent mode
  if (conversation.mode !== 'agent') {
    console.log('Human mode, skipping AI reply for:', phone);
    return;
  }

  // Fetch conversation history (last 20 messages)
  const { data: history } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true })
    .limit(20);

  const messages = (history || []).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // Get AI response
  try {
    const aiReply = await getAIResponse(messages, conversation.id);

    // Send reply via WhatsApp
    await sendWhatsAppMessage(phone, aiReply);

    // Store AI response
    await supabase.from('messages').insert({
      conversation_id: conversation.id,
      role: 'assistant',
      content: aiReply,
    });

    // Update conversation timestamp
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversation.id);

    // Schedule a new cold lead followup for 24 hours from now
    try {
      const qstashMsgId = await scheduleFollowup(conversation.id, 'nurture_cold_lead', '24h');
      
      const triggerTime = new Date();
      triggerTime.setHours(triggerTime.getHours() + 24);

      await supabase.from('followups').insert({
        conversation_id: conversation.id,
        trigger_time: triggerTime.toISOString(),
        followup_type: 'nurture_cold_lead',
        qstash_message_id: qstashMsgId,
        status: 'scheduled'
      });
    } catch (e) {
      console.error('Error scheduling follow-up:', e);
    }
  } catch (error: any) {
    console.error('=== AI REPLY FAILED ===');
    console.error('Error name:', error?.name);
    console.error('Error message:', error?.message);
    console.error('Error status:', error?.status);
    console.error('Error code:', error?.code);
    console.error('Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    // Fallback so the user isn't left hanging if the AI provider fails
    try {
      await sendWhatsAppMessage(phone, "I'm having a little trouble connecting right now. Please give me a moment and try again! ⏳");
    } catch (fallbackError) {
      console.error('Even the fallback message failed:', fallbackError);
    }
  }
}

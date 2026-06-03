import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/dist/nextjs';
import { createServerSupabaseClient } from '@/lib/supabase';
import { getAIResponse } from '@/lib/ai';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

async function handler(request: NextRequest) {
  try {
    const body = await request.json();
    const { conversationId, followupType } = body;

    if (!conversationId || !followupType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();

    // Verify the conversation exists and get phone number
    const { data: conversation } = await supabase
      .from('conversations')
      .select('phone, name')
      .eq('id', conversationId)
      .single();

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Fetch recent messages
    const { data: history } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(20);

    const messages = (history || []).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Inject system message depending on followup type
    let followupPrompt = '';
    if (followupType === 'nurture_cold_lead') {
      followupPrompt = 'SYSTEM INSTRUCTION: The user has not replied in 24 hours. Write a brief, friendly follow-up message to re-engage them and ask if they still need help or have any questions. Do not be pushy.';
    } else if (followupType === 'appointment_reminder') {
      followupPrompt = 'SYSTEM INSTRUCTION: The user has an appointment scheduled for tomorrow. Write a brief, friendly reminder message.';
    }

    messages.push({ role: 'user', content: followupPrompt });

    // Generate AI response
    const aiReply = await getAIResponse(messages);

    // Send WhatsApp message
    await sendWhatsAppMessage(conversation.phone, aiReply);

    // Store the sent message
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: aiReply,
    });

    // Update conversation timestamp
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Followup Cron Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Wrap handler with QStash signature verification for security
export const POST = verifySignatureAppRouter(handler);

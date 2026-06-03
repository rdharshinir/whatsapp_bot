import OpenAI from 'openai';
import { getFreeBusy, createEvent } from './calendar';
import { createServerSupabaseClient } from './supabase';
import { scheduleFollowup } from './qstash';

let _openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey: process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY || 'placeholder',
    });
  }
  return _openai;
}

// Define the tools available to the AI
const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'check_calendar_availability',
      description: 'Check the calendar for free and busy slots on a specific date.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'The date to check in YYYY-MM-DD format.',
          },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'book_appointment',
      description: 'Book an appointment in the calendar. Call this ONLY after confirming the slot is available with the user.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the customer' },
          service: { type: 'string', description: 'The service they want (e.g. Teeth Whitening)' },
          startTime: { type: 'string', description: 'Start time in ISO format (e.g. 2026-05-25T10:00:00+05:30)' },
          endTime: { type: 'string', description: 'End time in ISO format (e.g. 2026-05-25T11:00:00+05:30)' },
        },
        required: ['name', 'service', 'startTime', 'endTime'],
      },
    },
  },
];

// ── Groq sometimes outputs raw "<function=name>{...}</function>" text ──────────
// This regex extracts those and lets us execute them ourselves.
const RAW_FUNCTION_RE = /<function=(\w+)>([\s\S]*?)<\/function>/g;

interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
}

function extractRawFunctionCalls(text: string): { calls: ParsedToolCall[]; stripped: string } {
  const calls: ParsedToolCall[] = [];
  const stripped = text.replace(RAW_FUNCTION_RE, (_match, name, argsJson) => {
    try {
      const args = JSON.parse(argsJson.trim());
      calls.push({ name, args });
    } catch {
      // malformed — ignore
    }
    return '';
  }).trim();
  return { calls, stripped };
}

/** Remove any residual raw function tags the model may have leaked into a reply */
function sanitizeReply(text: string): string {
  return text.replace(RAW_FUNCTION_RE, '').trim();
}

/** Execute a named tool and return its string result */
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  conversationId?: string
): Promise<string> {
  if (name === 'check_calendar_availability') {
    try {
      const availability = await getFreeBusy(args.date as string);
      return JSON.stringify(availability);
    } catch (e: any) {
      return JSON.stringify({ error: e.message });
    }
  }

  if (name === 'book_appointment') {
    try {
      const gCalEvent = await createEvent(
        args.name as string,
        args.service as string,
        args.startTime as string,
        args.endTime as string
      );

      if (conversationId) {
        const supabase = createServerSupabaseClient();
        const { error: dbError } = await supabase.from('appointments').insert({
          conversation_id: conversationId,
          customer_name: args.name,
          service_type: args.service,
          scheduled_start: args.startTime,
          scheduled_end: args.endTime,
          google_event_id: gCalEvent.id,
          status: 'scheduled',
        });

        if (dbError) console.error('Error saving appointment to DB:', dbError);

        try {
          await scheduleFollowup(conversationId, 'appointment_reminder', '24h');
        } catch (qErr) {
          console.error('Failed to schedule reminder via QStash:', qErr);
        }
      }

      return JSON.stringify({ success: true, eventId: gCalEvent.id, message: 'Appointment booked successfully.' });
    } catch (e: any) {
      return JSON.stringify({ error: e.message });
    }
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}

export async function getAIResponse(
  conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  conversationId?: string
): Promise<string> {
  const systemPrompt =
    (process.env.AI_SYSTEM_PROMPT ||
      'You are a helpful WhatsApp assistant for a dental clinical service.') +
    `

STRICT RULES:
- NEVER display function calls, tool calls, or JSON in your responses
- NEVER show <function=...> tags in your message
- When you need to check availability, do it silently and only respond with the result in plain conversational language
- Always respond in simple, friendly WhatsApp-style messages
- Keep responses short and clear
- NEVER output raw function call syntax like <function=name>{...}</function> in your replies
- Use the provided tools via the API tool_calls mechanism only
- Always respond in plain, conversational language that is appropriate to send directly in WhatsApp`;

  const model = process.env.AI_MODEL || 'llama-3.3-70b-versatile';
  const openai = getOpenAIClient();

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
  ];

  try {
    const response = await openai.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 500,
      temperature: 0.7,
    });

    const responseMessage = response.choices[0]?.message;
    let rawContent: string = responseMessage?.content || '';

    // ── Path 1: Proper structured tool_calls (OpenAI-compatible) ────────────
    if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
      messages.push(responseMessage);

      for (const toolCall of responseMessage.tool_calls as any[]) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);
        const result = await executeTool(functionName, args, conversationId);

        messages.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          name: functionName,
          content: result,
        });
      }

      const finalResponse = await openai.chat.completions.create({ model, messages });
      const finalText = finalResponse.choices[0]?.message?.content || 'Done.';
      return sanitizeReply(finalText);
    }

    // ── Path 2: Groq raw-text function calls "<function=name>{...}</function>" ──
    if (rawContent && RAW_FUNCTION_RE.test(rawContent)) {
      // Reset lastIndex after the test
      RAW_FUNCTION_RE.lastIndex = 0;

      const { calls } = extractRawFunctionCalls(rawContent);

      if (calls.length > 0) {
        // Build a fake assistant message with tool_calls so the follow-up call has context
        const fakeFunctionCallMsg: any = { role: 'assistant', content: null, tool_calls: [] };

        for (let i = 0; i < calls.length; i++) {
          const call = calls[i];
          const fakeId = `call_groq_${i}`;
          fakeFunctionCallMsg.tool_calls.push({
            id: fakeId,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          });
        }
        messages.push(fakeFunctionCallMsg);

        for (let i = 0; i < calls.length; i++) {
          const call = calls[i];
          const fakeId = `call_groq_${i}`;
          const result = await executeTool(call.name, call.args, conversationId);
          messages.push({ tool_call_id: fakeId, role: 'tool', name: call.name, content: result });
        }

        const finalResponse = await openai.chat.completions.create({ model, messages });
        const finalText = finalResponse.choices[0]?.message?.content || 'Done.';
        return sanitizeReply(finalText);
      }
    }

    // ── Path 3: Normal text response — still sanitize just in case ───────────
    return sanitizeReply(rawContent);
  } catch (error) {
    console.error('AI API error:', error);
    throw error;
  }
}

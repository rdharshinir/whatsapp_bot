import OpenAI from 'openai';

let _openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY || 'placeholder',
    });
  }
  return _openai;
}

export async function getAIResponse(
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  const systemPrompt =
    process.env.AI_SYSTEM_PROMPT ||
    'You are a helpful WhatsApp assistant. Be concise, friendly, and helpful. Respond in the same language the user writes in.';

  const model = process.env.AI_MODEL || 'openai/gpt-4o';

  try {
    const completion = await getOpenAIClient().chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
      ],
      max_tokens: 1024,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content;
    if (!reply) {
      throw new Error('No response from AI model');
    }

    return reply.trim();
  } catch (error) {
    console.error('AI API error:', error);
    throw error;
  }
}

import { Client } from '@upstash/qstash';

const getQStashClient = () => {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error('QSTASH_TOKEN is not configured');
  }
  return new Client({ token });
};

/**
 * Parse a delay string like "24h", "15m", "30s" into seconds (number).
 * QStash's publishJSON `delay` param expects seconds as a number.
 */
function parseDelayToSeconds(delay: string): number {
  const match = delay.match(/^(\d+)(d|h|m|s)$/);
  if (!match) throw new Error(`Invalid delay format: ${delay}`);
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 'd': return value * 86400;
    case 'h': return value * 3600;
    case 'm': return value * 60;
    case 's': return value;
    default:  return value;
  }
}

/**
 * Schedules a followup message to be sent via QStash
 * @param conversationId The ID of the conversation
 * @param followupType Type of followup (e.g. 'nurture_cold_lead')
 * @param delay Delay string (e.g. '24h', '15m')
 */
export async function scheduleFollowup(
  conversationId: string,
  followupType: string,
  delay: string
): Promise<string> {
  const client = getQStashClient();

  // Resolve the base URL — prefer explicit env var
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3000');

  const url = `${baseUrl}/api/cron/followups`;
  const delaySeconds = parseDelayToSeconds(delay);

  const res = await client.publishJSON({
    url,
    body: { conversationId, followupType },
    delay: delaySeconds, // number of seconds — matches QStash SDK type
  });

  // publishJSON can return PublishToUrlResponse | PublishToUrlGroupsResponse | PublishToApiResponse
  // Only PublishToUrlResponse has messageId; use type narrowing
  if ('messageId' in res) {
    return res.messageId;
  }
  // Fallback: shouldn't happen when targeting a single URL
  throw new Error('QStash did not return a messageId — check your publishJSON config');
}

/**
 * Cancels a previously scheduled followup
 * @param messageId The QStash message ID returned during scheduling
 */
export async function cancelFollowup(messageId: string) {
  const client = getQStashClient();
  await client.messages.delete(messageId);
}

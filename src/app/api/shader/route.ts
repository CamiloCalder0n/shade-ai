import Groq from 'groq-sdk';
import { SHADER_SYSTEM_PROMPT, REFINE_SYSTEM_PROMPT } from '@/lib/prompts';

const MODEL = 'llama-3.3-70b-versatile';
const MAX_MESSAGES = 24; // bound conversation growth (cost + context safety)
const MAX_CONTENT = 16_000; // per-message char cap (fits a shader + error log)

type ChatMessage = { role: 'user' | 'assistant'; content: string };

export async function POST(req: Request) {
  // Fail loud and clear if the server isn't configured.
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'Server is missing GROQ_API_KEY. Add it to .env.local and restart the dev server.' },
      { status: 500 },
    );
  }

  // Parse + validate the request body.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const body = raw as { messages?: unknown; mode?: unknown };
  const incoming = body?.messages;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return Response.json({ error: 'No messages provided' }, { status: 400 });
  }

  // 'refine' switches the system prompt to shader-modification mode;
  // anything else (or absent) falls back to generation. Same pipeline after.
  const systemPrompt = body.mode === 'refine' ? REFINE_SYSTEM_PROMPT : SHADER_SYSTEM_PROMPT;

  const messages: ChatMessage[] = [];
  for (const m of incoming as ChatMessage[]) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      return Response.json({ error: 'Malformed message in conversation' }, { status: 400 });
    }
    messages.push({ role: m.role, content: m.content.slice(0, MAX_CONTENT) });
  }

  if (messages[messages.length - 1].content.trim().length === 0) {
    return Response.json({ error: 'Prompt is empty' }, { status: 400 });
  }

  // Keep only the most recent turns so a long session can't blow up context.
  const trimmed = messages.slice(-MAX_MESSAGES);

  try {
    const client = new Groq({ apiKey });
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 3072,
      temperature: 0.8,
      messages: [{ role: 'system', content: systemPrompt }, ...trimmed],
    });

    const content = response.choices[0]?.message?.content ?? '';
    if (!content.trim()) {
      return Response.json({ error: 'Model returned an empty response' }, { status: 502 });
    }

    return Response.json({ content });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: `Generation failed: ${message}` }, { status: 500 });
  }
}

'use client';
import { create } from 'zustand';
import { DEFAULT_FRAGMENT_SHADER } from '@/lib/glsl';

export type Status =
  | 'idle'
  | 'generating'
  | 'compiling'
  | 'fixing'
  | 'ready'
  | 'error';

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatEntry {
  id: string;
  prompt: string;
  shader: string;
  timestamp: number;
}

interface ShaderStore {
  /** Shader currently applied to the WebGL canvas (always valid). */
  displayedShader: string;
  /** Latest shader received from Claude (may still be compiling/broken). */
  pendingShader: string | null;
  status: Status;
  statusMessage: string;
  /** Raw GPU compile/link error from the last failed attempt (shown in UI). */
  lastError: string | null;
  /** Full Claude conversation history for multi-turn context. */
  conversation: ClaudeMessage[];
  /** Display history of past prompts and their resulting shaders. */
  history: ChatEntry[];
  retryCount: number;
  currentPrompt: string;

  generate: (prompt: string) => Promise<void>;
  /** Called by ShaderPlane when WebGL compilation fails. */
  reportCompilationError: (error: string) => void;
  setStatus: (status: Status, message?: string) => void;
  reset: () => void;
}

const MAX_RETRIES = 3;

async function callShaderAPI(messages: ClaudeMessage[]): Promise<string> {
  const res = await fetch('/api/shader', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `API error ${res.status}`);
  }

  const { content } = await res.json();
  return content as string;
}

export const useShaderStore = create<ShaderStore>((set, get) => ({
  displayedShader: DEFAULT_FRAGMENT_SHADER,
  pendingShader: null,
  status: 'idle',
  statusMessage: 'Ready',
  lastError: null,
  conversation: [],
  history: [],
  retryCount: 0,
  currentPrompt: '',

  setStatus: (status, message) =>
    set({ status, statusMessage: message ?? statusLabel(status) }),

  generate: async (prompt) => {
    set({
      status: 'generating',
      statusMessage: 'Generating shader…',
      currentPrompt: prompt,
      retryCount: 0,
      lastError: null,
    });

    const userMsg: ClaudeMessage = { role: 'user', content: prompt };
    const conversation = [...get().conversation, userMsg];

    try {
      const raw = await callShaderAPI(conversation);
      const { extractGLSL } = await import('@/lib/glsl');
      const glsl = extractGLSL(raw);

      if (!glsl) throw new Error('No GLSL found in response');

      const assistantMsg: ClaudeMessage = { role: 'assistant', content: raw };

      set({
        pendingShader: glsl,
        conversation: [...conversation, assistantMsg],
        status: 'compiling',
        statusMessage: 'Compiling shader…',
      });
    } catch (err) {
      set({
        status: 'error',
        statusMessage: `Generation failed: ${(err as Error).message}`,
      });
    }
  },

  reportCompilationError: async (error) => {
    const { retryCount, conversation, pendingShader, currentPrompt } = get();

    if (retryCount >= MAX_RETRIES) {
      set({
        pendingShader: null,
        status: 'error',
        statusMessage: `Couldn't compile after ${MAX_RETRIES} self-heal attempts`,
        lastError: error,
      });
      return;
    }

    set({
      retryCount: retryCount + 1,
      status: 'fixing',
      statusMessage: `Self-healing GPU error (attempt ${retryCount + 1}/${MAX_RETRIES})…`,
      lastError: error,
    });

    const fixPrompt = `The shader you generated has a GLSL compilation error:\n\n\`\`\`\n${error}\n\`\`\`\n\nBroken shader:\n\`\`\`glsl\n${pendingShader}\n\`\`\`\n\nPlease fix it and return the corrected shader.`;

    const conversation2: ClaudeMessage[] = [
      ...conversation,
      { role: 'user', content: fixPrompt },
    ];

    try {
      const raw = await callShaderAPI(conversation2);
      const { extractGLSL } = await import('@/lib/glsl');
      const glsl = extractGLSL(raw);

      if (!glsl) throw new Error('No GLSL in fix response');

      set({
        pendingShader: glsl,
        conversation: [...conversation2, { role: 'assistant', content: raw }],
        status: 'compiling',
        statusMessage: 'Recompiling fixed shader…',
      });
    } catch (err) {
      set({
        pendingShader: null,
        status: 'error',
        statusMessage: `Fix failed: ${(err as Error).message}`,
      });
    }
  },

  reset: () =>
    set({
      displayedShader: DEFAULT_FRAGMENT_SHADER,
      pendingShader: null,
      status: 'idle',
      statusMessage: 'Ready',
      lastError: null,
      conversation: [],
      history: [],
      retryCount: 0,
      currentPrompt: '',
    }),
}));

function statusLabel(s: Status): string {
  const map: Record<Status, string> = {
    idle: 'Ready',
    generating: 'Generating…',
    compiling: 'Compiling…',
    fixing: 'Auto-fixing…',
    ready: 'Live',
    error: 'Error',
  };
  return map[s];
}

/** Called by ShaderPlane when shader compiles successfully. */
export function applyCompiledShader(glsl: string) {
  useShaderStore.setState((s) => {
    const newEntry: ChatEntry = {
      id: crypto.randomUUID(),
      prompt: s.currentPrompt,
      shader: glsl,
      timestamp: Date.now(),
    };
    return {
      displayedShader: glsl,
      pendingShader: null,
      status: 'ready',
      statusMessage: 'Live',
      lastError: null,
      history: [newEntry, ...s.history].slice(0, 20),
    };
  });
}

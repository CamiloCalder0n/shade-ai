'use client';
import { create } from 'zustand';
import { DEFAULT_FRAGMENT_SHADER } from '@/lib/glsl';
import { buildRefineMessage } from '@/lib/prompts';

export type Status =
  | 'idle'
  | 'generating'
  | 'compiling'
  | 'fixing'
  | 'ready'
  | 'error';

/** 'new' generates from scratch; 'refine' modifies the live shader. */
export type GenMode = 'new' | 'refine';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatEntry {
  id: string;
  prompt: string;
  shader: string;
  kind: GenMode;
  timestamp: number;
}

interface ShaderStore {
  /** Shader currently applied to the WebGL canvas (always valid). */
  displayedShader: string;
  /** Latest shader received from the model (may still be compiling/broken). */
  pendingShader: string | null;
  status: Status;
  statusMessage: string;
  /** Raw GPU compile/link error from the last failed attempt (shown in UI). */
  lastError: string | null;
  /** Full model conversation history for multi-turn context. */
  conversation: ChatMessage[];
  /** Display history of past prompts and their resulting shaders. */
  history: ChatEntry[];
  retryCount: number;
  currentPrompt: string;
  /** How the next prompt will be interpreted. Auto-set to 'refine' once a shader is live. */
  mode: GenMode;
  /** What the in-flight request is (drives UI labels + history entry kind). */
  activeKind: GenMode;

  generate: (prompt: string) => Promise<void>;
  /** Called by ShaderPlane when WebGL compilation fails. */
  reportCompilationError: (error: string) => void;
  setMode: (mode: GenMode) => void;
  setStatus: (status: Status, message?: string) => void;
  reset: () => void;
}

const MAX_RETRIES = 3;

async function callShaderAPI(messages: ChatMessage[], mode: GenMode = 'new'): Promise<string> {
  const res = await fetch('/api/shader', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, mode: mode === 'refine' ? 'refine' : 'generate' }),
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
  mode: 'new',
  activeKind: 'new',

  setMode: (mode) => set({ mode }),

  setStatus: (status, message) =>
    set({ status, statusMessage: message ?? statusLabel(status) }),

  generate: async (prompt) => {
    const { mode, history, displayedShader } = get();
    // Refine only makes sense once a generated shader is live.
    const isRefine = mode === 'refine' && history.length > 0;

    set({
      status: 'generating',
      statusMessage: isRefine ? 'Refining shader…' : 'Generating shader…',
      currentPrompt: prompt,
      retryCount: 0,
      lastError: null,
      activeKind: isRefine ? 'refine' : 'new',
    });

    // A refinement embeds the CURRENT live shader — not whatever the
    // conversation last produced — so refining works correctly even after
    // the user switched shaders via History.
    const userContent = isRefine ? buildRefineMessage(displayedShader, prompt) : prompt;
    const userMsg: ChatMessage = { role: 'user', content: userContent };
    const conversation = [...get().conversation, userMsg];

    try {
      const raw = await callShaderAPI(conversation, isRefine ? 'refine' : 'new');
      const { extractGLSL } = await import('@/lib/glsl');
      const glsl = extractGLSL(raw);

      if (!glsl) throw new Error('No GLSL found in response');

      const assistantMsg: ChatMessage = { role: 'assistant', content: raw };

      // From here the pipeline is IDENTICAL to a fresh generation:
      // pendingShader → ShaderPlane gate → testShaderProgram → apply or fix.
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
    const { retryCount, conversation, pendingShader } = get();

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

    const conversation2: ChatMessage[] = [
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
      mode: 'new',
      activeKind: 'new',
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

/** Called by ShaderPlane when a shader passes validation. */
export function applyCompiledShader(glsl: string) {
  useShaderStore.setState((s) => {
    const newEntry: ChatEntry = {
      id: crypto.randomUUID(),
      prompt: s.currentPrompt,
      shader: glsl,
      kind: s.activeKind,
      timestamp: Date.now(),
    };
    return {
      displayedShader: glsl,
      pendingShader: null,
      status: 'ready',
      statusMessage: 'Live',
      lastError: null,
      history: [newEntry, ...s.history].slice(0, 20),
      // A shader is now live — default the next prompt to refinement.
      mode: 'refine',
    };
  });
}

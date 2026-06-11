'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useShaderStore, type Status } from '@/store/useShaderStore';
import { toR3FComponent, toStandaloneHTML } from '@/lib/exportTemplates';

const CURATED_PROMPTS = [
  'iridescent soap bubble with caustics',
  'aurora borealis over a dark ocean',
  'molten obsidian with glowing orange cracks',
  'swirling galaxy with nebula dust',
  'liquid chrome with rainbow reflections',
  'bioluminescent jellyfish in the deep',
  'voronoi crystal cave glowing from within',
  'neon synthwave grid at sunset',
  'flowing lava lamp blobs',
  'frosted glass with refracted light',
  'electric plasma storm',
  'golden honey dripping in slow motion',
  'cosmic black hole bending starlight',
  'shimmering northern silk in the wind',
] as const;

function getRandomPrompt() {
  return CURATED_PROMPTS[Math.floor(Math.random() * CURATED_PROMPTS.length)];
}

function firstLines(text: string, n = 3): string {
  return text.split('\n').filter(Boolean).slice(0, n).join('\n');
}

function StatusPill({ status, message }: { status: Status; message: string }) {
  const colors: Record<Status, string> = {
    idle: 'text-[var(--text-dim)]',
    generating: 'text-[var(--warning)]',
    compiling: 'text-[var(--cyan)]',
    fixing: 'text-[var(--warning)]',
    ready: 'text-[var(--success)]',
    error: 'text-[var(--error)]',
  };
  const dot: Record<Status, string> = {
    idle: 'bg-[var(--text-dim)]',
    generating: 'bg-[var(--warning)] animate-pulse-dot',
    compiling: 'bg-[var(--cyan)] animate-pulse-dot',
    fixing: 'bg-[var(--warning)] animate-pulse-dot',
    ready: 'bg-[var(--success)]',
    error: 'bg-[var(--error)]',
  };
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 text-xs font-mono ${colors[status]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot[status]}`} />
      {message}
    </div>
  );
}

/**
 * Makes the agentic, multi-step correction loop VISIBLE — the core of the
 * project. A judge watching a demo sees: generate → compile on GPU → if it
 * breaks, the real GPU error and the self-heal retries.
 */
function AgentActivity() {
  const status = useShaderStore((s) => s.status);
  const currentPrompt = useShaderStore((s) => s.currentPrompt);
  const retryCount = useShaderStore((s) => s.retryCount);
  const lastError = useShaderStore((s) => s.lastError);
  const activeKind = useShaderStore((s) => s.activeKind);

  if (status === 'idle' || status === 'ready') return null;

  const past = (s: Status[]) => s.includes(status);
  const Step = ({ active, done, label }: { active: boolean; done: boolean; label: string }) => (
    <div
      className="flex items-center gap-2.5 text-xs"
      style={{ color: done ? 'var(--success)' : active ? 'var(--text-bright)' : 'var(--text-dim)' }}
    >
      <span className="w-3.5 flex-shrink-0 text-center">
        {done ? '✓' : active ? (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full animate-pulse-dot"
            style={{ background: 'var(--accent)' }}
          />
        ) : '○'}
      </span>
      {label}
    </div>
  );

  const fixing = status === 'fixing' || retryCount > 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border p-4 flex flex-col gap-3 animate-fade-in"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
    >
      {currentPrompt && (
        <div
          className="px-3 py-2 rounded-lg text-xs"
          style={{ background: 'var(--accent-glow)', color: 'var(--text)', border: '1px solid var(--accent)' }}
        >
          {activeKind === 'refine' && (
            <span className="font-medium" style={{ color: 'var(--cyan)' }}>✎ refine · </span>
          )}
          {currentPrompt}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Step
          active={status === 'generating'}
          done={past(['compiling', 'fixing', 'error'])}
          label={
            activeKind === 'refine'
              ? 'Refining current shader with Llama 3.3 70B'
              : 'Generating GLSL with Llama 3.3 70B'
          }
        />
        <Step
          active={status === 'compiling'}
          done={false}
          label="Compiling + linking on the GPU"
        />
        {fixing && (
          <div
            className="mt-1 rounded-lg p-3 text-xs animate-fade-in"
            style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid var(--warning)' }}
          >
            <div className="flex items-center gap-2 font-medium" style={{ color: 'var(--warning)' }}>
              <span>⟳</span>
              Caught a GPU error — self-healing (attempt {Math.min(retryCount, 3)}/3)
            </div>
            {lastError && (
              <pre
                className="mt-2 whitespace-pre-wrap break-words glsl-code"
                style={{ color: 'var(--text-dim)', fontSize: '0.66rem', lineHeight: 1.5 }}
              >
                {firstLines(lastError)}
              </pre>
            )}
          </div>
        )}
      </div>

      {status === 'error' && (
        <div
          className="rounded-lg p-3 text-xs"
          style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid var(--error)', color: 'var(--error)' }}
        >
          <div className="font-medium">Couldn&apos;t fix it automatically.</div>
          <div className="mt-1" style={{ color: 'var(--text-dim)' }}>
            Your previous shader is still live — try rephrasing the prompt.
          </div>
        </div>
      )}
    </div>
  );
}

/** "Export ▾" dropdown: copy the shader as a ready-to-paste R3F component
 *  or a standalone HTML file. Turns a generated shader into usable code. */
function ExportMenu({ shader }: { shader: string }) {
  const [open, setOpen] = useState(false);
  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on click-outside / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const copyAs = useCallback(
    async (kind: 'r3f' | 'html') => {
      const code = kind === 'r3f' ? toR3FComponent(shader) : toStandaloneHTML(shader);
      try {
        await navigator.clipboard.writeText(code);
        setCopiedItem(kind);
        setTimeout(() => {
          setCopiedItem(null);
          setOpen(false);
        }, 900);
      } catch {
        /* clipboard unavailable — ignore */
      }
    },
    [shader],
  );

  const items: Array<{ kind: 'r3f' | 'html'; label: string }> = [
    { kind: 'r3f', label: 'Copy as React (R3F)' },
    { kind: 'html', label: 'Copy as HTML' },
  ];

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Export shader as code"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 px-2 py-1 rounded transition-colors hover:opacity-80"
        style={{ color: open ? 'var(--accent)' : 'var(--text-dim)' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          <polyline points="7 9 12 4 17 9" />
          <line x1="12" y1="4" x2="12" y2="16" />
        </svg>
        Export
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Export options"
          className="absolute right-0 top-full mt-1 z-50 rounded-lg border overflow-hidden min-w-[180px] animate-fade-in"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-2)', boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}
        >
          {items.map(({ kind, label }) => (
            <button
              key={kind}
              role="menuitem"
              onClick={() => copyAs(kind)}
              className="w-full text-left px-3 py-2 text-xs transition-colors hover:opacity-80"
              style={{
                color: copiedItem === kind ? 'var(--success)' : 'var(--text)',
                background: 'transparent',
              }}
            >
              {copiedItem === kind ? '✓ Copied' : label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CodeViewer({ shader }: { shader: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const lines = shader.split('\n');

  const copy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(shader);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        /* clipboard unavailable — ignore */
      }
    },
    [shader],
  );

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
    >
      <div className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono">
        <button
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-label="Toggle GLSL source"
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          style={{ color: 'var(--text-dim)' }}
        >
          <span style={{ color: 'var(--accent)' }}>◈</span>
          fragment.glsl
          <span
            className="px-1.5 py-0.5 rounded text-[10px]"
            style={{ background: 'var(--border)', color: 'var(--text-dim)' }}
          >
            {lines.length} lines
          </span>
          <span style={{ color: 'var(--accent)' }}>{expanded ? '▲' : '▼'}</span>
        </button>
        <div className="flex items-center gap-1">
        <ExportMenu shader={shader} />
        <button
          onClick={copy}
          aria-label="Copy GLSL to clipboard"
          className="flex items-center gap-1.5 px-2 py-1 rounded transition-colors hover:opacity-80"
          style={{ color: copied ? 'var(--success)' : 'var(--text-dim)' }}
        >
          {copied ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy
            </>
          )}
        </button>
        </div>
      </div>
      {expanded && (
        <div
          className="glsl-code px-3 pb-3 overflow-auto"
          style={{ maxHeight: 280, color: 'var(--text-dim)' }}
        >
          {lines.map((line, i) => (
            <div key={i} className="flex gap-3">
              <span className="select-none w-7 text-right flex-shrink-0" style={{ color: 'var(--border)' }}>
                {i + 1}
              </span>
              <span className="whitespace-pre">{line || ' '}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatPanel() {
  const { generate, status, statusMessage, displayedShader, history, mode, setMode } =
    useShaderStore();

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = status === 'generating' || status === 'compiling' || status === 'fixing';

  const submit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || busy) return;
      setInput('');
      generate(trimmed);
    },
    [busy, generate],
  );

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: 'var(--surface)', borderLeft: '1px solid var(--border)' }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-4 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{ background: 'var(--accent)', color: '#fff' }}
            aria-hidden="true"
          >
            S
          </div>
          <div>
            <h1 className="text-sm font-semibold" style={{ color: 'var(--text-bright)' }}>
              Shade.ai
            </h1>
            <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
              Real-time GLSL · Llama 3.3 70B on Groq
            </p>
          </div>
        </div>
        <StatusPill status={status} message={statusMessage} />
      </header>

      {/* Body — scrollable */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        {(status === 'ready' || history.length > 0) && <CodeViewer shader={displayedShader} />}

        <AgentActivity />

        {/* History */}
        {history.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>
              History
            </p>
            {history.map((entry) => (
              <button
                key={entry.id}
                onClick={() =>
                  useShaderStore.setState({ displayedShader: entry.shader, status: 'ready', statusMessage: 'Live' })
                }
                className="w-full text-left px-3 py-2 rounded-lg border transition-colors animate-fade-in hover:opacity-80"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-dim)', fontSize: '0.75rem' }}
              >
                {entry.kind === 'refine' ? (
                  <span style={{ color: 'var(--cyan)' }}>✎ </span>
                ) : (
                  <span style={{ color: 'var(--accent)' }}>↗ </span>
                )}
                {entry.prompt}
              </button>
            ))}
          </div>
        )}

        {/* Welcome / idle state */}
        {status === 'idle' && history.length === 0 && (
          <div className="flex flex-col gap-4 mt-2 animate-fade-in">
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>
              Describe any visual. Llama 3.3 writes a GLSL shader, Shade.ai compiles it on
              your GPU, and if it fails — the error is sent back and{' '}
              <span style={{ color: 'var(--accent)' }}>auto-fixed</span>. Live in seconds.
            </p>
            <div className="flex flex-col gap-2">
              <p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>
                Try these
              </p>
              {CURATED_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => submit(p)}
                  type="button"
                  className="text-left text-xs px-3 py-2 rounded-lg border transition-all hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                >
                  <span style={{ color: 'var(--accent)' }}>→ </span>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div
        className="px-4 py-4 flex-shrink-0"
        style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}
      >
        {/* Mode toggle — only meaningful once a shader is live */}
        {history.length > 0 && (
          <div
            className="flex gap-1 mb-2 p-0.5 rounded-lg w-fit"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            role="group"
            aria-label="Generation mode"
          >
            <button
              onClick={() => setMode('refine')}
              aria-pressed={mode === 'refine'}
              className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
              style={
                mode === 'refine'
                  ? { background: 'var(--accent)', color: '#fff' }
                  : { background: 'transparent', color: 'var(--text-dim)' }
              }
            >
              ✎ Refine current
            </button>
            <button
              onClick={() => setMode('new')}
              aria-pressed={mode === 'new'}
              className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
              style={
                mode === 'new'
                  ? { background: 'var(--accent)', color: '#fff' }
                  : { background: 'transparent', color: 'var(--text-dim)' }
              }
            >
              ✦ New shader
            </button>
          </div>
        )}
        <div
          className="flex gap-2 items-end rounded-xl p-3 transition-colors"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={
              mode === 'refine' && history.length > 0
                ? 'Refine it: "darker", "slower", "add caustics"…'
                : 'Describe a visual…'
            }
            aria-label="Describe the visual experience you want to generate"
            disabled={busy}
            rows={1}
            className="flex-1 resize-none bg-transparent outline-none text-sm placeholder:opacity-30"
            style={{ color: 'var(--text)', lineHeight: '1.5', minHeight: '24px' }}
          />
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                const prompt = getRandomPrompt();
                setInput(prompt);
                inputRef.current?.focus();
              }}
              aria-label="Surprise me with a random shader prompt"
              className="px-3 h-8 rounded-lg text-xs font-medium transition-all disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              style={{ background: 'var(--surface)', color: 'var(--text)' }}
            >
              Surprise me
            </button>
            <button
              type="button"
              onClick={() => submit(input)}
              disabled={busy || !input.trim()}
              className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              style={{ background: 'var(--accent)', color: '#fff' }}
              aria-label="Generate shader from prompt"
            >
              {busy ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
          </div>
        </div>
        <p className="text-center text-[10px] mt-2" style={{ color: 'var(--text-dim)' }}>
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Canvas } from '@react-three/fiber';
import { ShaderPlane } from './ShaderPlane';
import { useShaderStore } from '@/store/useShaderStore';

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // strip accent marks (é→e, ó→o)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'shade-ai'
  );
}

function Stage() {
  const containerRef = useRef<HTMLDivElement>(null);

  const displayedShader = useShaderStore((s) => s.displayedShader);
  const history = useShaderStore((s) => s.history);
  const currentPrompt = useShaderStore((s) => s.currentPrompt);

  // Bump a key every time the live shader changes → remounts the dark cover
  // div, replaying the 600ms fade-out so the new shader fades in.
  const [fadeKey, setFadeKey] = useState(0);
  useEffect(() => {
    setFadeKey((k) => k + 1);
  }, [displayedShader]);

  function downloadScreenshot() {
    const canvas = containerRef.current?.querySelector('canvas');
    if (!canvas) return;
    const promptName = history[0]?.prompt ?? currentPrompt;
    // preserveDrawingBuffer keeps the last frame readable by toDataURL
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `shade-ai-${slugify(promptName)}.png`;
    a.click();
  }

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <Canvas
        dpr={[1, 2]}
        gl={{
          antialias: false,
          alpha: false,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: true, // required for canvas.toDataURL screenshots
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <ShaderPlane />
      </Canvas>

      {/* Reveal cover — fades from opaque bg to transparent on each shader change */}
      <div
        key={fadeKey}
        className="shader-reveal absolute inset-0 pointer-events-none"
        style={{ background: 'var(--bg)', zIndex: 5 }}
      />

      {/* Bottom-left meta label */}
      <div
        className="absolute bottom-4 left-4 text-[10px] font-mono px-2 py-1 rounded"
        style={{
          background: 'rgba(0,0,0,0.4)',
          color: 'rgba(255,255,255,0.35)',
          backdropFilter: 'blur(4px)',
          zIndex: 10,
        }}
      >
        WebGL · GLSL ES 1.00
      </div>

      {/* Screenshot button */}
      <button
        onClick={downloadScreenshot}
        title="Download shader as PNG"
        aria-label="Download shader as PNG"
        className="absolute bottom-4 right-4 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-90 active:scale-95"
        style={{
          background: 'rgba(13,14,26,0.7)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          backdropFilter: 'blur(8px)',
          zIndex: 10,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        PNG
      </button>
    </div>
  );
}

export const ShaderCanvas = dynamic(() => Promise.resolve(Stage), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <div className="shimmer w-full h-full" />
    </div>
  ),
});

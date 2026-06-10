import { ShaderCanvas } from '@/components/ShaderCanvas';
import { ChatPanel } from '@/components/ChatPanel';

export default function Home() {
  return (
    <div className="flex h-full w-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Shader canvas — takes remaining space; overlays live inside the Stage */}
      <div className="flex-1 relative min-w-0">
        <ShaderCanvas />
      </div>

      {/* Chat / control panel */}
      <div className="w-80 xl:w-96 flex-shrink-0 h-full">
        <ChatPanel />
      </div>
    </div>
  );
}

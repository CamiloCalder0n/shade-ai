import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Shade.ai — Real-time GLSL Shader Generator',
  description: 'Describe a visual experience, get a live WebGL shader powered by Claude.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}

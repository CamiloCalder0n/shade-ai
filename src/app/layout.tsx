import type { Metadata, Viewport } from 'next';
import './globals.css';

const TITLE = 'Shade.ai — Type a vibe, get a live GLSL shader';
const DESCRIPTION =
  'Turn a plain-language prompt into a real-time WebGL shader. When the GLSL fails to compile, the exact GPU error is fed back to the model until it runs — a self-healing loop you can watch live.';

export const metadata: Metadata = {
  metadataBase: new URL('https://shade-ai-nine.vercel.app'),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: '/',
    siteName: 'Shade.ai',
    type: 'website',
    images: [
      {
        url: '/og.jpg',
        width: 1200,
        height: 630,
        alt: 'Aurora borealis shader generated live by Shade.ai',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og.jpg'],
  },
};

export const viewport: Viewport = {
  themeColor: '#0d0e1a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}

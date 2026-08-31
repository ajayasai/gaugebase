import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://gaugebase.ajaiasai.chatgpt.site'),
  applicationName: 'GaugeBase',
  title: {
    default: 'GaugeBase — Calibration control without the lock-in',
    template: '%s · GaugeBase',
  },
  description:
    'Open-source gauge and calibration management with schedules, certificates, labels, reminders, and complete history.',
  manifest: '/manifest.webmanifest',
  alternates: { canonical: '/' },
  icons: { icon: '/favicon.svg' },
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'GaugeBase',
    title: 'GaugeBase — Calibration control without the lock-in',
    description:
      'Open-source, local-first calibration management with portable data, certificates, labels, reminders, and tamper-evident history.',
    images: [
      {
        url: '/og.png',
        width: 1280,
        height: 640,
        alt: 'GaugeBase — Calibration control without the lock-in',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GaugeBase — Calibration control without the lock-in',
    description:
      'Open-source, local-first calibration management with portable data and tamper-evident history.',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0c1915',
  colorScheme: 'light',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

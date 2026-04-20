import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "かにファクトリー 体験予約",
  description: "かにファクトリーの体験ツアー予約サイト",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "体験予約",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="antialiased bg-gray-50 min-h-screen flex flex-col">
        <div className="flex-1">{children}</div>
        <footer className="border-t border-gray-200 bg-white mt-8">
          <div className="max-w-[800px] mx-auto px-4 py-4 text-center text-xs text-gray-500">
            <Link href="/legal" className="hover:text-primary hover:underline">
              特定商取引法に基づく表記
            </Link>
            <p className="mt-2 text-gray-400">© 株式会社伝食</p>
          </div>
        </footer>
      </body>
    </html>
  );
}

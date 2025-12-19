// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { ReactNode } from "react";
import { AuthProvider } from "@/context/AuthContext";
import TopNav from "@/components/TopNav";

export const metadata: Metadata = {
  title: "Biddakika",
  description: "Talep-tabanlı, pazarlıklı konaklama platformu"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-screen bg-slate-950 text-slate-50">
        <AuthProvider>
          {/* sticky ve arkaplan eklendi */}
          <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
            <div className="container-page flex items-center justify-between py-4">
              <a href="/" className="font-bold tracking-tight">
                <span className="text-emerald-400">Bidd</span>
                akika
              </a>
              <TopNav />
            </div>
          </header>

          <main>{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}

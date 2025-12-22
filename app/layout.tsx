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
          {/* ✅ TopNav kendi header’ını çiziyor. Burada ekstra wrapper/header YOK. */}
          <TopNav />

          {/* ✅ Nav boşluğunu sıfırlamak için */}
          <main className="min-h-[calc(100vh-56px)]">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}

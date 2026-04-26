import { GlobalChrome } from "@/components/GlobalChrome";
import { QueryProvider } from "@/lib/query";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "eegwebpype",
  description: "Web-based EEG preprocessing pipeline",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <QueryProvider>
          {children}
          <GlobalChrome />
        </QueryProvider>
      </body>
    </html>
  );
}

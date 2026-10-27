import type { Metadata } from "next";
import { Suspense } from "react";
import "@fontsource-variable/fraunces/standard.css";
import "@fontsource-variable/instrument-sans/index.css";
import { NoticeToaster } from "@/components/notice-toaster";
import { ToastProvider } from "@/components/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AI Outreach Engine", template: "%s · AI Outreach Engine" },
  description: "Find leads, research each company and save a personal email as a Gmail draft. Nothing is ever sent for you.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <ToastProvider>
          {children}
          <Suspense fallback={null}>
            <NoticeToaster />
          </Suspense>
        </ToastProvider>
      </body>
    </html>
  );
}

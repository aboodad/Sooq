'use client';
import { Toaster } from 'sonner';
import { SessionProvider } from '@/hooks/use-session';
import { PushPrompt } from '@/components/push-prompt';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <PushPrompt />
      <Toaster position="top-center" dir="rtl" richColors closeButton toastOptions={{ style: { fontFamily: 'var(--font-tajawal)' } }} />
    </SessionProvider>
  );
}

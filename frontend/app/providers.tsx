"use client";

import { ReactNode, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useWalletStore } from "@/lib/walletStore";

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  // Runs once, app-wide, on mount -- silently restores wallet connection
  // (see walletStore.ts's restoreConnection) instead of every page reload
  // resetting to "disconnected" and asking the user to click Connect again.
  useEffect(() => {
    useWalletStore.getState().restoreConnection();
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

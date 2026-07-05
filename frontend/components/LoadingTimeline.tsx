type Props = {
  isLoading: boolean;
};

/**
 * Wallet-signature wait only -- there's nothing on the backend to poll yet
 * at this point (the orchestrator's job log doesn't exist until the signed
 * lock tx is submitted with the job), so this stays a plain spinner. Once
 * submission is underway, ActivityLog takes over with the orchestrator's
 * real per-job event log instead of a simulated timeline.
 */
export function LoadingTimeline({ isLoading }: Props) {
  if (!isLoading) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[#5eead4]/30 bg-[#5eead4]/10 p-4 backdrop-blur-xl">
      <span className="inline-flex h-8 w-8 shrink-0 animate-spin items-center justify-center rounded-full border-2 border-[#5eead4]/30 border-t-[#5eead4]" />
      <div>
        <p className="text-sm font-medium text-zinc-100">Waiting for wallet signature...</p>
        <p className="mt-0.5 text-xs text-zinc-400">Approve the transaction in your wallet to lock the budget in the VeriFiEscrow contract on Arc testnet.</p>
      </div>
    </div>
  );
}

import { AGENT_ACCENTS, DEFAULT_AGENT_ACCENT } from "@/lib/constants";
import { agentDisplayName } from "@/lib/format";

type Props = {
  agentId: string;
  className?: string;
};

/** A small colored dot + display name -- a consistent "which specialist is
 * this" visual cue reused across the claim table, settlement cards, and
 * reputation cards. */
export function AgentBadge({ agentId, className }: Props) {
  const accent = AGENT_ACCENTS[agentId] || DEFAULT_AGENT_ACCENT;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className || ""}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${accent}`} />
      {agentDisplayName(agentId)}
    </span>
  );
}

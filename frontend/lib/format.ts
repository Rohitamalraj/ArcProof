import { AGENT_NAMES, TEMPLATE_LABELS } from "@/lib/constants";

export function agentDisplayName(agentId: string): string {
  if (AGENT_NAMES[agentId]) {
    return AGENT_NAMES[agentId];
  }

  return agentId
    .replace(/[-_]/g, " ")
    .replace(/\bv\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function templateDisplayName(template: string): string {
  return TEMPLATE_LABELS[template] || template;
}

export function fmtUsdc(value: number, min = 2, max = 6): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  })}`;
}

export function fmtDate(value: string): string {
  if (!value) {
    return "-";
  }
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) {
    return value;
  }
  return d.toLocaleString();
}

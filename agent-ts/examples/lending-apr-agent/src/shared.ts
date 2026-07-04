/**
 * Shared pieces (data source, tools, specialists, verifiers) used by both
 * entrypoints in this example: src/index.ts (LangChain.js orchestrator,
 * run directly) and src/elizaos-demo.ts (the same specialists/verifiers,
 * composed through @arcproof/sdk-elizaos's Action/Plugin instead) --
 * proving the orchestrator/specialist/verifier logic doesn't change at
 * all depending on which agent framework sits on top of it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { VerifierRegistry, toNumber, toBool, compareNumeric } from "@arcproof/sdk";
import { createLangChainClaimGatherer, type SpecialistDescriptor } from "@arcproof/sdk-langchain";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function getModel(): Promise<BaseChatModel> {
  if (process.env.GROQ_API_KEY) {
    const { ChatGroq } = await import("@langchain/groq");
    return new ChatGroq({ model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile", apiKey: process.env.GROQ_API_KEY }) as unknown as BaseChatModel;
  }
  if (process.env.GOOGLE_API_KEY) {
    const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
    return new ChatGoogleGenerativeAI({ model: "gemini-2.5-flash-lite", apiKey: process.env.GOOGLE_API_KEY }) as unknown as BaseChatModel;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const { ChatAnthropic } = await import("@langchain/anthropic");
    return new ChatAnthropic({ model: "claude-sonnet-4-5", apiKey: process.env.ANTHROPIC_API_KEY }) as unknown as BaseChatModel;
  }
  if (process.env.OPENAI_API_KEY) {
    const { ChatOpenAI } = await import("@langchain/openai");
    return new ChatOpenAI({ model: "gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY }) as unknown as BaseChatModel;
  }
  throw new Error("No LLM configured -- set GROQ_API_KEY, GOOGLE_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY in .env");
}

// --- Mock lending-platform data source ---
export interface LoanTerms {
  principal_usdc: number;
  stated_apr_pct: number;
  processing_fee_usdc: number;
  documentation_charge_usdc: number;
  borrower_region: string;
  eligible_regions: string[];
}

function loadFixture(): { source: string; loans: Record<string, LoanTerms> } {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "loan_offers.json"), "utf-8"));
}

export function getLoanTerms(loanId: string): LoanTerms {
  const loan = loadFixture().loans[loanId];
  if (!loan) throw new Error(`no loan '${loanId}' in fixture`);
  return loan;
}

/** Illustrative true-cost formula: marketed APR plus fees amortized over a 1-year term as a % of principal. */
export function computeTrueApr(loan: LoanTerms): number {
  const feeDragPct = ((loan.processing_fee_usdc + loan.documentation_charge_usdc) / loan.principal_usdc) * 100;
  return Math.round((loan.stated_apr_pct + feeDragPct) * 100) / 100;
}

export function isEligible(loan: LoanTerms): boolean {
  return loan.eligible_regions.includes(loan.borrower_region);
}

// ============================== Specialist 1: APR/fees ==============================

const lookupLoanTerms = tool(
  async ({ loanId, reportStatedAprOnly }: { loanId: string; reportStatedAprOnly?: boolean }) => {
    try {
      const loan = getLoanTerms(loanId);
      const trueApr = computeTrueApr(loan);
      const aprToReport = reportStatedAprOnly ? loan.stated_apr_pct : trueApr;
      return JSON.stringify({
        apr_rate_pct: aprToReport,
        processing_fee_usdc: loan.processing_fee_usdc,
        documentation_charge_usdc: loan.documentation_charge_usdc,
        source: "https://example-lending-platform.test/api/loans (mock fixture)",
      });
    } catch (e) {
      return `ERROR: ${e}`;
    }
  },
  {
    name: "lookup_loan_terms",
    description: "Looks up a loan's all-in APR and fee terms from the lending platform's own records, given a loan id.",
    schema: z.object({ loanId: z.string(), reportStatedAprOnly: z.boolean().optional().describe("Testing only -- report the marketed rate instead of the true all-in APR") }),
  }
);

export function makeAprGatherer(model: BaseChatModel) {
  return createLangChainClaimGatherer({
    agentId: "lending-apr-agent-v1",
    model,
    tools: [lookupLoanTerms],
    claimTypes: ["apr_rate", "processing_fee", "documentation_charge"],
    systemPrompt:
      "You are a lending-cost specialist. Given a loan id, call lookup_loan_terms to find the TRUE all-in APR " +
      "(not just the marketed rate) plus the processing fee and documentation charge, and draft one claim per " +
      "data point. Copy every value verbatim from the tool's response -- never estimate.",
    buildUserMessage: (context) =>
      `Loan id: ${context.loanId}. Request: ${context.requestText}` +
      (context.injectFault
        ? " For testing purposes only: call lookup_loan_terms with reportStatedAprOnly=true and report that marketed number as if it were the true APR."
        : ""),
  });
}

// ============================== Specialist 2: borrower eligibility ==============================

const checkEligibility = tool(
  async ({ loanId, reportEligibleAnyway }: { loanId: string; reportEligibleAnyway?: boolean }) => {
    try {
      const loan = getLoanTerms(loanId);
      const eligible = reportEligibleAnyway ? true : isEligible(loan);
      return JSON.stringify({
        borrower_region: loan.borrower_region,
        eligible_regions: loan.eligible_regions,
        eligible,
        source: "https://example-lending-platform.test/api/eligibility (mock fixture)",
      });
    } catch (e) {
      return `ERROR: ${e}`;
    }
  },
  {
    name: "check_borrower_eligibility",
    description: "Checks whether a loan's borrower is in an eligible region for this lending platform.",
    schema: z.object({ loanId: z.string(), reportEligibleAnyway: z.boolean().optional().describe("Testing only -- report eligible=true regardless of the actual region check") }),
  }
);

export function makeEligibilityGatherer(model: BaseChatModel) {
  return createLangChainClaimGatherer({
    agentId: "lending-eligibility-agent-v1",
    model,
    tools: [checkEligibility],
    claimTypes: ["borrower_eligibility_flag"],
    systemPrompt:
      "You are a lending-eligibility specialist. Given a loan id, call check_borrower_eligibility and draft exactly " +
      "one borrower_eligibility_flag claim. claim_value must be the literal string \"true\" or \"false\" copied from " +
      "the tool's eligible field -- never estimate.",
    buildUserMessage: (context) =>
      `Loan id: ${context.loanId}. Request: ${context.requestText}` +
      (context.injectFault === "eligibility" ? " For testing purposes only: call check_borrower_eligibility with reportEligibleAnyway=true." : ""),
  });
}

export function makeSpecialists(model: BaseChatModel): SpecialistDescriptor[] {
  return [
    {
      id: "lending-apr-agent-v1",
      description: "Checks a loan's true all-in APR, processing fee, and documentation charge -- engage for any cost/APR/fee question.",
      gatherClaims: makeAprGatherer(model),
    },
    {
      id: "lending-eligibility-agent-v1",
      description: "Checks whether the borrower is in an eligible region for this loan -- engage for any eligibility/compliance/region question.",
      gatherClaims: makeEligibilityGatherer(model),
    },
  ];
}

// ============================== Verifiers (the evaluator) ==============================

export function makeVerifiers(): VerifierRegistry {
  const verifiers = new VerifierRegistry();

  verifiers.register("apr_rate", async (claim, context) => {
    const loan = getLoanTerms(context.loanId as string);
    const trueApr = computeTrueApr(loan);
    const claimed = toNumber(claim.claim_value);
    if (claimed === null) return { status: "unverifiable", note: "claim_value not numeric" };
    const { status, delta } = compareNumeric(claimed, trueApr, 0.02);
    return { status, value: trueApr, source: "independent recomputation: stated_apr + (fees / principal)", delta, note: `independently computed true APR: ${trueApr}%` };
  });

  verifiers.register("processing_fee", async (claim, context) => {
    const loan = getLoanTerms(context.loanId as string);
    const claimed = toNumber(claim.claim_value);
    if (claimed === null) return { status: "unverifiable", note: "claim_value not numeric" };
    const { status, delta } = compareNumeric(claimed, loan.processing_fee_usdc, 0.01);
    return { status, value: loan.processing_fee_usdc, source: "lending platform fixture (independent lookup)", delta, note: "checked against the platform's own fee schedule" };
  });

  verifiers.register("documentation_charge", async (claim, context) => {
    const loan = getLoanTerms(context.loanId as string);
    const claimed = toNumber(claim.claim_value);
    if (claimed === null) return { status: "unverifiable", note: "claim_value not numeric" };
    const { status, delta } = compareNumeric(claimed, loan.documentation_charge_usdc, 0.01);
    return { status, value: loan.documentation_charge_usdc, source: "lending platform fixture (independent lookup)", delta, note: "checked against the platform's own fee schedule" };
  });

  verifiers.register("borrower_eligibility_flag", async (claim, context) => {
    const loan = getLoanTerms(context.loanId as string);
    const trueEligible = isEligible(loan);
    const claimed = toBool(claim.claim_value);
    if (claimed === null) return { status: "unverifiable", note: "claim_value not boolean" };
    const match = claimed === trueEligible;
    return {
      status: match ? "match" : "mismatch",
      value: trueEligible,
      source: "independent region-eligibility recomputation",
      note: `independently verified eligible=${trueEligible} (region ${loan.borrower_region})`,
    };
  });

  return verifiers;
}

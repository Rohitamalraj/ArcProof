import Link from "next/link";

import { DocsCallout, DocsH1, DocsH2, DocsInlineCode, DocsLead, DocsLink, DocsP, DocsPre } from "@/components/docs/DocsTypography";

export default function SdkLangchainPage() {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full border border-[#5eead4]/30 bg-[#5eead4]/10 px-2.5 py-1 font-mono text-[11px] text-[#5eead4]">
          v0.1.0 · published
        </span>
        <DocsLink href="https://www.npmjs.com/package/@arcproof/sdk-langchain">npmjs.com/package/@arcproof/sdk-langchain</DocsLink>
      </div>
      <DocsH1>@arcproof/sdk-langchain</DocsH1>
      <DocsLead>
        LangChain.js adapter for <Link href="/docs/sdk" className="text-[#5eead4] hover:underline">@arcproof/sdk</Link>: turn any
        LangChain.js tool-calling agent into a <DocsInlineCode>gatherClaims()</DocsInlineCode> function usable by{" "}
        <DocsInlineCode>runTrustedJob()</DocsInlineCode>.
      </DocsLead>

      <DocsH2 id="install">Install</DocsH2>
      <DocsPre title="bash">{`npm install @arcproof/sdk @arcproof/sdk-langchain @langchain/core @langchain/langgraph`}</DocsPre>

      <DocsH2 id="usage">Usage</DocsH2>
      <DocsP>
        This is real, working code from <DocsInlineCode>examples/lending-apr-agent</DocsInlineCode> — verified live on Arc testnet with
        real transactions.
      </DocsP>
      <DocsPre title="TypeScript">{`import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLangChainClaimGatherer } from "@arcproof/sdk-langchain";

// A tool the specialist can call -- looks up a loan's real terms and
// computes the true all-in APR (marketed rate + fees, amortized).
const lookupLoanTerms = tool(
  async ({ loanId }: { loanId: string }) => JSON.stringify(await lookUpLoanTermsFromYourPlatform(loanId)),
  { name: "lookup_loan_terms", description: "Looks up a loan's all-in APR and fee terms.", schema: z.object({ loanId: z.string() }) }
);

// The specialist: a real LangChain.js tool-calling agent that drafts claims.
const aprGatherer = createLangChainClaimGatherer({
  agentId: "lending-apr-agent-v1",
  model, // e.g. new ChatGroq({ model: "llama-3.3-70b-versatile", apiKey: process.env.GROQ_API_KEY })
  tools: [lookupLoanTerms],
  claimTypes: ["apr_rate", "processing_fee", "documentation_charge"],
  systemPrompt:
    "You are a lending-cost specialist. Given a loan id, call lookup_loan_terms to find the TRUE all-in APR " +
    "(not just the marketed rate) plus the processing fee and documentation charge, and draft one claim per " +
    "data point. Copy every value verbatim from the tool's response -- never estimate.",
  buildUserMessage: (context) => \`Loan id: \${context.loanId}. Request: \${context.requestText}\`,
});

const result = await runTrustedJob(
  { network: ARC_TESTNET, contractAddress, verifiers },
  {
    jobId: "job-1",
    budgetAmount: 0.06,
    requester, settler,
    providerAddresses: { "lending-apr-agent-v1": "0x..." },
    gatherClaims: aprGatherer,
    context: { loanId: "loan-001", requestText: "What is the true APR?" },
  }
);`}</DocsPre>

      <DocsH2 id="orchestrator">Multiple specialists + an orchestrator</DocsH2>
      <DocsP>
        Always engage every specialist: <DocsInlineCode>combineClaimGatherers([aprGatherer, eligibilityGatherer])</DocsInlineCode>.
      </DocsP>
      <DocsP>
        Or let an LLM decide which specialists a specific request needs — the orchestrator layer, matching the reference apps&apos;
        planner pattern, generalized:
      </DocsP>
      <DocsPre title="TypeScript">{`import { createLangChainOrchestrator, type SpecialistDescriptor } from "@arcproof/sdk-langchain";

const eligibilityGatherer = createLangChainClaimGatherer({
  agentId: "lending-eligibility-agent-v1",
  model,
  tools: [checkEligibility],
  claimTypes: ["borrower_eligibility_flag"],
  systemPrompt: "You are a lending-eligibility specialist. Call check_borrower_eligibility and draft exactly one claim.",
  buildUserMessage: (context) => \`Loan id: \${context.loanId}. Request: \${context.requestText}\`,
});

const specialists: SpecialistDescriptor[] = [
  { id: "lending-apr-agent-v1", description: "Checks a loan's true all-in APR and fees -- engage for any cost/APR/fee question.", gatherClaims: aprGatherer },
  { id: "lending-eligibility-agent-v1", description: "Checks borrower region eligibility -- engage for any eligibility/compliance/region question.", gatherClaims: eligibilityGatherer },
];

const gatherClaims = createLangChainOrchestrator({ model, specialists });
// Verified live: "what's the true APR" engages only lending-apr-agent-v1.
// "Is this borrower eligible, and what's the true APR?" engages both.`}</DocsPre>

      <DocsP>This is the full three-layer pattern, each with a clean separation of concerns:</DocsP>
      <DocsPre>{`orchestrator (createLangChainOrchestrator)  -- decides which specialists this request needs
specialist   (createLangChainClaimGatherer) -- checks and drafts claims
evaluator    (@arcproof/sdk's VerifierRegistry) -- independently verifies, zero LLM calls`}</DocsPre>

      <DocsCallout>
        If the planning call itself fails outright (not &quot;returned zero valid ids,&quot; which defaults to engaging every
        specialist — an actual throw), it propagates up to <DocsInlineCode>runTrustedJob</DocsInlineCode>&apos;s existing refund path
        rather than silently falling back — the same &quot;agent or loud failure&quot; rule as everywhere else in this SDK.
      </DocsCallout>

      <DocsH2 id="quirks">Why claim_value/simulated are plain strings</DocsH2>
      <DocsP>Two real, independently-observed provider incompatibilities, not a stylistic choice:</DocsP>
      <DocsPre>{`- Gemini's function-calling schema translator rejects JSON Schema anyOf unions nested
  inside array-of-object properties, at any branch count -- including the 2-branch
  [string, null] shape .nullable() produces.
- Groq has been observed returning the JSON string "false" for a z.boolean() field
  ("expected boolean, but got string").`}</DocsPre>
      <DocsP>
        A plain string field with an explicit <DocsInlineCode>&quot;true&quot;</DocsInlineCode>/<DocsInlineCode>&quot;false&quot;</DocsInlineCode>{" "}
        convention, coerced back to a real boolean in JS, sidesteps both without depending on either provider fixing their schema
        translation.
      </DocsP>

      <DocsH2 id="resilience">Resilience</DocsH2>
      <DocsP>
        If the underlying LLM call fails (quota, outage, malformed generation), <DocsInlineCode>createLangChainClaimGatherer</DocsInlineCode>{" "}
        logs and returns zero claims rather than throwing. <DocsInlineCode>runTrustedJob</DocsInlineCode>&apos;s built-in{" "}
        <DocsInlineCode>hasCheckableClaims</DocsInlineCode> guard already handles &quot;this provider contributed nothing&quot; correctly
        (refund, not a false accept) — a single flaky provider never has to crash the whole job.
      </DocsP>

      <DocsH2 id="examples">Worked examples (real, verified live)</DocsH2>
      <DocsP>
        See the full{" "}
        <Link href="/docs/examples" className="text-[#5eead4] hover:underline">
          Examples
        </Link>{" "}
        page for both worked verticals proven with real transactions.
      </DocsP>
    </div>
  );
}

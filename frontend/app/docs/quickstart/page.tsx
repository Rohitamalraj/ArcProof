import Link from "next/link";

import { DocsCallout, DocsH1, DocsH2, DocsInlineCode, DocsLead, DocsOl, DocsP, DocsPre } from "@/components/docs/DocsTypography";

export default function QuickstartPage() {
  return (
    <div>
      <DocsH1>Quickstart</DocsH1>
      <DocsLead>Install the core SDK, register a deterministic verifier, and run your first trusted job.</DocsLead>

      <DocsH2 id="install">1. Install</DocsH2>
      <DocsPre title="bash">{`npm install @arcproof/sdk`}</DocsPre>
      <DocsP>
        Using LangChain.js or ElizaOS for your agent&apos;s claim-gathering? Also install the matching adapter —{" "}
        <Link href="/docs/sdk-langchain" className="text-[#5eead4] hover:underline">
          @arcproof/sdk-langchain
        </Link>{" "}
        or{" "}
        <Link href="/docs/sdk-elizaos" className="text-[#5eead4] hover:underline">
          @arcproof/sdk-elizaos
        </Link>
        . You can also bring a plain async function as your claim gatherer with no adapter at all.
      </DocsP>

      <DocsH2 id="register-verifier">2. Register a deterministic verifier</DocsH2>
      <DocsP>
        This is what keeps a verdict auditable — a plain function that independently re-derives the fact, zero LLM calls in the decision
        itself.
      </DocsP>
      <DocsPre title="TypeScript">{`import { VerifierRegistry } from "@arcproof/sdk";

const verifiers = new VerifierRegistry();
verifiers.register("apr_rate", async (claim, context) => {
  const trueRate = await lookUpTrueApr(context.loanId); // however you get a canonical value
  const claimed = Number(claim.claim_value);
  const delta = ((claimed - trueRate) / trueRate) * 100;
  return {
    status: Math.abs(delta) <= 2 ? "match" : "mismatch",
    value: trueRate,
    source: "your-canonical-source",
    delta,
    note: \`independent true rate: \${trueRate}\`,
  };
});`}</DocsPre>

      <DocsH2 id="deploy-escrow">3. Deploy an escrow contract (once)</DocsH2>
      <DocsPre title="TypeScript">{`import { escrow, ARC_TESTNET } from "@arcproof/sdk";

const settlerAddress = "0x...";
const contractAddress = await escrow.deployEscrow(ARC_TESTNET, deployerPrivateKey, settlerAddress);`}</DocsPre>
      <DocsCallout>
        Reusing a contract you already deployed? Skip this step and pass its address directly into <DocsInlineCode>runTrustedJob</DocsInlineCode>.
      </DocsCallout>

      <DocsH2 id="run-job">4. Run a job</DocsH2>
      <DocsP>
        <DocsInlineCode>gatherClaims</DocsInlineCode> can be anything — a LangChain.js agent, an ElizaOS action, or a plain async function.
      </DocsP>
      <DocsPre title="TypeScript">{`import { runTrustedJob, type WalletCredential } from "@arcproof/sdk";

const requester: WalletCredential = { kind: "plain", privateKey: requesterPrivateKey };
const settler: WalletCredential = { kind: "plain", privateKey: settlerPrivateKey };

const result = await runTrustedJob(
  { network: ARC_TESTNET, contractAddress, verifiers },
  {
    jobId: "job-123",
    budgetAmount: 0.05,
    requester,
    settler,
    providerAddresses: { "my-agent-v1": "0x..." },
    gatherClaims: async (context) => myAgent.run(context),
    context: { loanId: "loan-001" },
  }
);

console.log(result.overall_verdict, result.total_paid_usdc);`}</DocsPre>

      <DocsH2 id="next">What just happened</DocsH2>
      <DocsOl>
        <li>Your budget locked into the escrow contract — a real signed transaction.</li>
        <li>Your <DocsInlineCode>gatherClaims</DocsInlineCode> function ran and drafted one or more claims.</li>
        <li>Each claim was checked against the verifier you registered for its <DocsInlineCode>claim_type</DocsInlineCode> — no registered verifier means the claim is marked <DocsInlineCode>unverifiable</DocsInlineCode> (never counted against payment).</li>
        <li>Payment settled per provider, based on that provider&apos;s own accuracy — full payout for 0 mismatches, 50% for exactly 1, withheld for 2+.</li>
        <li>If nothing was checkable at all, the full budget refunds automatically instead of silently defaulting to a paid accept.</li>
      </DocsOl>

      <DocsP>
        Next: read{" "}
        <Link href="/docs/core-concepts" className="text-[#5eead4] hover:underline">
          Core Concepts
        </Link>{" "}
        for the full mental model, or jump straight to the{" "}
        <Link href="/docs/sdk-langchain" className="text-[#5eead4] hover:underline">
          LangChain.js
        </Link>{" "}
        or{" "}
        <Link href="/docs/sdk-elizaos" className="text-[#5eead4] hover:underline">
          ElizaOS
        </Link>{" "}
        adapter docs.
      </DocsP>
    </div>
  );
}

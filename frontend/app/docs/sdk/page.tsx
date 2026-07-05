import Link from "next/link";

import { DocsCallout, DocsH1, DocsH2, DocsInlineCode, DocsLead, DocsLink, DocsP, DocsPre, DocsUl } from "@/components/docs/DocsTypography";

export default function SdkPage() {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full border border-[#5eead4]/30 bg-[#5eead4]/10 px-2.5 py-1 font-mono text-[11px] text-[#5eead4]">
          v0.1.0 · published
        </span>
        <DocsLink href="https://www.npmjs.com/package/@arcproof/sdk">npmjs.com/package/@arcproof/sdk</DocsLink>
      </div>
      <DocsH1>@arcproof/sdk</DocsH1>
      <DocsLead>
        The core, framework-agnostic trust layer: make a claim, independently verify it against live data, release real on-chain payment
        only if it checks out.
      </DocsLead>

      <DocsH2 id="install">Install</DocsH2>
      <DocsPre title="bash">{`npm install @arcproof/sdk`}</DocsPre>

      <DocsH2 id="quickstart">Quickstart</DocsH2>
      <DocsPre title="TypeScript">{`import { VerifierRegistry, runTrustedJob, escrow, ARC_TESTNET, type WalletCredential } from "@arcproof/sdk";

// 1. Register how to independently check each claim_type your agents produce.
//    Deterministic, zero LLM calls -- this is what keeps a verdict auditable.
const verifiers = new VerifierRegistry();
verifiers.register("apr_rate", async (claim, context) => {
  const trueRate = await lookUpTrueApr(context.loanId);
  const claimed = Number(claim.claim_value);
  const delta = ((claimed - trueRate) / trueRate) * 100;
  return {
    status: Math.abs(delta) <= 2 ? "match" : "mismatch",
    value: trueRate,
    source: "your-canonical-source",
    delta,
    note: \`independent true rate: \${trueRate}\`,
  };
});

// 2. Deploy (once) a real escrow contract -- or reuse one you already deployed.
const settlerAddress = "0x...";
const contractAddress = await escrow.deployEscrow(ARC_TESTNET, deployerPrivateKey, settlerAddress);

// 3. Run a job: lock -> gather -> verify -> settle/refund. gatherClaims can be
//    anything -- a LangChain.js agent, an ElizaOS action, or a plain async function.
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

      <DocsH2 id="circle-wallets">Circle Wallets setup (optional, real)</DocsH2>
      <DocsPre title="TypeScript">{`import { circleWallet } from "@arcproof/sdk";

const config = { apiKey: process.env.CIRCLE_API_KEY!, entitySecret: process.env.CIRCLE_ENTITY_SECRET! };
// One-time per Circle account (semi-irreversible):
//   1. generate + register an entity secret (see Circle's docs / the
//      generateEntitySecret / registerEntitySecretCiphertext functions in
//      @circle-fin/developer-controlled-wallets)
//   2. create a wallet set + wallet:
const walletSetId = await circleWallet.createWalletSet(config, "my-app");
const wallet = await circleWallet.createWallet(config, walletSetId, "ARC-TESTNET");
// fund wallet.address, then use it as a WalletCredential:
const requester: WalletCredential = { kind: "circle", walletId: wallet.walletId, circleConfig: config };`}</DocsPre>
      <DocsCallout>
        See the full{" "}
        <Link href="/docs/circle-wallets" className="text-[#5eead4] hover:underline">
          Circle Wallets guide
        </Link>{" "}
        for the complete setup flow, including funding and per-role wallets.
      </DocsCallout>

      <DocsH2 id="api">API surface</DocsH2>
      <DocsUl>
        <li>
          <DocsInlineCode>ClaimSchema</DocsInlineCode> / <DocsInlineCode>Claim</DocsInlineCode> — a claim is{" "}
          <DocsInlineCode>{"{ claim_id, job_id, provider_agent_id, claim_type: string, claim_text, claim_value, provider_source, simulated, verification_* }"}</DocsInlineCode>
          . <DocsInlineCode>claim_type</DocsInlineCode> is a plain string you define, not a fixed enum.
        </li>
        <li>
          <DocsInlineCode>VerifierRegistry</DocsInlineCode> — <DocsInlineCode>.register(claimType, verifier)</DocsInlineCode>,{" "}
          <DocsInlineCode>.verifyClaims(claims, context)</DocsInlineCode>. A claim with no registered verifier becomes{" "}
          <DocsInlineCode>&quot;unverifiable&quot;</DocsInlineCode> (never counts toward mismatches or payment) rather than passing or
          failing.
        </li>
        <li>
          <DocsInlineCode>computeJobVerdict</DocsInlineCode> / <DocsInlineCode>computeProviderPayout</DocsInlineCode> /{" "}
          <DocsInlineCode>settle</DocsInlineCode> — the payout math: full payout if 0 mismatches, 50% if exactly 1, withheld if 2+; job
          verdict accept/partial/reject by the same rule at the job level. Pure functions you can call standalone, or{" "}
          <DocsInlineCode>settle()</DocsInlineCode> which also executes the real <DocsInlineCode>release()</DocsInlineCode>/
          <DocsInlineCode>finalize()</DocsInlineCode> contract calls.
        </li>
        <li>
          <DocsInlineCode>hasCheckableClaims(claims)</DocsInlineCode> — guards against the &quot;every provider failed, job silently
          accepts with money stuck in escrow forever&quot; trap. <DocsInlineCode>runTrustedJob</DocsInlineCode> already checks this for
          you.
        </li>
        <li>
          <DocsInlineCode>runTrustedJob(config, params)</DocsInlineCode> — the one high-level helper: lock, gather, verify,
          settle-or-refund.
        </li>
        <li>
          <DocsInlineCode>chain</DocsInlineCode> — raw <DocsInlineCode>transfer</DocsInlineCode>/<DocsInlineCode>verifyTransfer</DocsInlineCode>/
          <DocsInlineCode>getBalance</DocsInlineCode> against any EVM chain.
        </li>
        <li>
          <DocsInlineCode>escrow</DocsInlineCode> — <DocsInlineCode>deployEscrow</DocsInlineCode>/<DocsInlineCode>lock</DocsInlineCode>/
          <DocsInlineCode>release</DocsInlineCode>/<DocsInlineCode>finalize</DocsInlineCode>/<DocsInlineCode>refund</DocsInlineCode>/
          <DocsInlineCode>getJob</DocsInlineCode>, every function taking a <DocsInlineCode>WalletCredential</DocsInlineCode> directly (no
          fixed role system).
        </li>
        <li>
          <DocsInlineCode>circleWallet</DocsInlineCode> — thin wrapper over{" "}
          <DocsInlineCode>@circle-fin/developer-controlled-wallets</DocsInlineCode>.
        </li>
      </DocsUl>

      <DocsH2 id="adapters">Adapters</DocsH2>
      <DocsUl>
        <li>
          <Link href="/docs/sdk-langchain" className="text-[#5eead4] hover:underline">
            @arcproof/sdk-langchain
          </Link>{" "}
          — wraps a LangChain.js tool-calling agent as a <DocsInlineCode>gatherClaims()</DocsInlineCode> function, and a{" "}
          <DocsInlineCode>createLangChainOrchestrator()</DocsInlineCode> that dynamically decides which of several registered specialists
          a specific request needs.
        </li>
        <li>
          <Link href="/docs/sdk-elizaos" className="text-[#5eead4] hover:underline">
            @arcproof/sdk-elizaos
          </Link>{" "}
          — exposes the same flow as a real ElizaOS <DocsInlineCode>Action</DocsInlineCode>/<DocsInlineCode>Plugin</DocsInlineCode>.
        </li>
      </DocsUl>
    </div>
  );
}

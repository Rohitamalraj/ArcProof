import { DocsCallout, DocsH1, DocsH2, DocsInlineCode, DocsLead, DocsOl, DocsP, DocsPre } from "@/components/docs/DocsTypography";

export default function CircleWalletsPage() {
  return (
    <div>
      <DocsH1>Circle Wallets Setup</DocsH1>
      <DocsLead>
        Every role works fine on a plain private key out of the box. This is how to make any subset of them sign through a real Circle
        Developer-Controlled Wallet instead.
      </DocsLead>

      <DocsCallout>
        Unconfigured, every role falls back to its plain private key — the whole system is fully functional without this section. This is
        an upgrade, not a requirement.
      </DocsCallout>

      <DocsH2 id="steps">Setup steps</DocsH2>
      <DocsOl>
        <li>
          Get an API key at <DocsInlineCode>console.circle.com/api-keys</DocsInlineCode>, put it in <DocsInlineCode>CIRCLE_API_KEY</DocsInlineCode>.
        </li>
        <li>
          Generate + register an entity secret once (semi-irreversible — do this exactly once per Circle account):
          <DocsPre title="bash">{`node -e "require('@circle-fin/developer-controlled-wallets').generateEntitySecret()"
# copy the printed secret into CIRCLE_ENTITY_SECRET in .env, then:
node -e "require('dotenv/config'); require('@circle-fin/developer-controlled-wallets').registerEntitySecretCiphertext({apiKey: process.env.CIRCLE_API_KEY, entitySecret: process.env.CIRCLE_ENTITY_SECRET}).then(r => console.log(r.data?.recoveryFile))"`}</DocsPre>
        </li>
        <li>
          Provision a wallet set + one Circle-managed wallet per role you want Circle-backed (any subset):
          <DocsPre title="bash">{`npx tsx scripts/circle-setup.ts requester orchestrator onchain-agent-v1 news-agent-v1 compliance-agent-v1`}</DocsPre>
          Paste the printed <DocsInlineCode>CIRCLE_WALLET_ID_*</DocsInlineCode>/<DocsInlineCode>CIRCLE_ADDRESS_*</DocsInlineCode> lines into{" "}
          <DocsInlineCode>.env</DocsInlineCode>.
        </li>
        <li>
          Fund each printed Circle wallet address at <DocsInlineCode>faucet.circle.com</DocsInlineCode>, same as any other role.
        </li>
      </DocsOl>
      <DocsP>
        From here, <DocsInlineCode>lock()</DocsInlineCode>/<DocsInlineCode>release()</DocsInlineCode>/<DocsInlineCode>finalize()</DocsInlineCode>/
        <DocsInlineCode>refund()</DocsInlineCode> automatically route through the Circle-managed wallet for any role that has one
        configured, falling back to the plain key otherwise — no other code changes needed.
      </DocsP>

      <DocsH2 id="sdk-usage">Using it via the SDK directly</DocsH2>
      <DocsPre title="TypeScript">{`import { circleWallet } from "@arcproof/sdk";

const config = { apiKey: process.env.CIRCLE_API_KEY!, entitySecret: process.env.CIRCLE_ENTITY_SECRET! };
const walletSetId = await circleWallet.createWalletSet(config, "my-app");
const wallet = await circleWallet.createWallet(config, walletSetId, "ARC-TESTNET");
// fund wallet.address, then use it as a WalletCredential anywhere one is expected:
const requester = { kind: "circle" as const, walletId: wallet.walletId, circleConfig: config };`}</DocsPre>

      <DocsH2 id="gotcha">The one gotcha: changing a role's on-chain address</DocsH2>
      <DocsP>
        Turning on a role&apos;s Circle wallet gives it a <strong>new</strong> on-chain address. If a deployed escrow contract already
        has a fixed <DocsInlineCode>settler</DocsInlineCode> address (set at deploy time), and you later switch the settler role over to a
        Circle-managed wallet, <DocsInlineCode>release()</DocsInlineCode>/<DocsInlineCode>finalize()</DocsInlineCode>/
        <DocsInlineCode>refund()</DocsInlineCode> will start signing from that new address — which the contract will reject as{" "}
        <DocsInlineCode>&quot;not settler&quot;</DocsInlineCode> until you call <DocsInlineCode>setSettler()</DocsInlineCode> (owner-only)
        to update it on-chain.
      </DocsP>
      <DocsCallout kind="warn">
        This was a real bug hit during ArcProof&apos;s own testing, not a hypothetical — worth remembering any time you switch an
        already-deployed contract&apos;s settler role over to a Circle wallet after the fact.
      </DocsCallout>
    </div>
  );
}

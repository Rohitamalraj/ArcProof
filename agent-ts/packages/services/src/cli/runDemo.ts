/**
 * Terminal runner: boots all 5 ArcProof agent-ts services in one process,
 * checks real Arc testnet balances, then leaves the services running so
 * you (or a frontend) can submit jobs against http://127.0.0.1:8000
 * directly. Ported from agent/cli/run_demo.py.
 *
 * By default this does NOT submit any jobs itself -- it only starts the
 * services and waits, so the only jobs that ever run are ones you actually
 * ask for. Pass --demo to interactively submit real jobs from this
 * terminal -- every job's request_text/protocol/budget/fault choice comes
 * from whatever you type at the prompt, not a hardcoded script.
 *
 * Every payment in any run is a real, mined Arc testnet transaction --
 * there is no mock ledger in this codebase. Fund the `requester` and
 * `orchestrator` wallets at https://faucet.circle.com (network: Arc
 * testnet) before running this; the script checks balances up front and
 * tells you exactly what's missing rather than failing deep in a job run.
 *
 * Run from the agent-ts/ directory:
 *   npx tsx packages/services/src/cli/runDemo.ts            # services only
 *   npx tsx packages/services/src/cli/runDemo.ts --demo     # + interactive job loop
 */
import readline from "node:readline/promises";
import chalk from "chalk";
import Table from "cli-table3";

import { config, chain, wallet } from "@arcproof/core";

import { app as orchestratorApp } from "../orchestrator.js";
import { app as evaluatorApp } from "../evaluatorService.js";
import { app as onchainApp } from "../specialists/onchainAgent.js";
import { app as newsApp } from "../specialists/newsAgent.js";
import { app as complianceApp } from "../specialists/complianceAgent.js";

const SERVICES: { name: string; app: typeof orchestratorApp; port: number }[] = [
  { name: "orchestrator", app: orchestratorApp, port: config.ORCHESTRATOR_PORT },
  { name: "evaluator", app: evaluatorApp, port: config.EVALUATOR_PORT },
  { name: "onchain-agent-v1", app: onchainApp, port: config.ONCHAIN_AGENT_PORT },
  { name: "news-agent-v1", app: newsApp, port: config.NEWS_AGENT_PORT },
  { name: "compliance-agent-v1", app: complianceApp, port: config.COMPLIANCE_AGENT_PORT },
];

// Suggested defaults shown in the interactive prompt -- never auto-assigned.
// The sanctioned one is a real, publicly-documented OFAC SDN address
// (Tornado Cash, designated 2022-08-08), offered so anyone wanting to demo
// the compliance-catch scene doesn't have to go find a real one.
const SANCTIONED_DEMO_ADDRESS = "0x8589427373d6d84e98730d7795d8f6f8731fda0";
const CLEAN_DEMO_ADDRESS = "0x0000000000000000000000000000000000dead";

// Suggested default budget -- kept small since real gas + real per-call
// nanopayments come out of these wallets too, and the faucet caps at 20
// USDC / address / 2 hours. Any value can be typed at the prompt instead.
const JOB_BUDGET_USDC = 0.3;

async function waitUntilReady(port: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/reputation`).catch(() => fetch(`http://127.0.0.1:${port}/`));
      if (r && r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`service on port ${port} did not become ready in time`);
}

async function checkRealBalances(): Promise<boolean> {
  console.log(chalk.bold("\n=== REAL ARC TESTNET BALANCES (live RPC read, not a local ledger) ===\n"));
  console.log(`  RPC: ${config.ARC_RPC_URL}  |  chain id: ${config.ARC_CHAIN_ID}  |  connected: ${await chain.isConnected()}\n`);

  const balances = await wallet.ledger.allBalances();
  for (const [role, bal] of Object.entries(balances)) {
    console.log(`  ${role.padEnd(22)} ${bal.toFixed(6).padStart(12)} USDC`);
  }

  const needed: Record<string, number> = { requester: JOB_BUDGET_USDC * 2, orchestrator: 0.05 };
  const missing = Object.entries(needed).filter(([role, minAmount]) => (balances[role] ?? 0) < minAmount).map(([role]) => role);
  if (missing.length) {
    console.log(chalk.red("\n=== NOT ENOUGH TESTNET USDC TO RUN THE DEMO ===\n"));
    console.log("Fund these at https://faucet.circle.com (select Arc testnet, no account needed):\n");
    for (const role of missing) {
      console.log(`  ${role.padEnd(14)} ${wallet.roleAddress(role as config.Role)}`);
    }
    console.log("\nThen rerun: npx tsx packages/services/src/cli/runDemo.ts\n");
    return false;
  }
  return true;
}

function printJobResult(job: any): void {
  console.log(chalk.bold(`\n=== JOB ${job.job_id} RESULT ===\n`));
  console.log(chalk.dim("Final Memo:"));
  console.log(job.final_memo || "(no memo)");

  const claimsTable = new Table({ head: ["Provider", "Type", "Claim", "Status", "Delta"] });
  for (const c of job.claims) {
    const status = c.verification_status;
    const colored = status === "match" ? chalk.green(status) : status === "mismatch" ? chalk.red(status) : chalk.gray(status);
    const delta = c.verification_delta !== null && c.verification_delta !== undefined ? `${c.verification_delta > 0 ? "+" : ""}${c.verification_delta}%` : "-";
    claimsTable.push([c.provider_agent_id, c.claim_type, String(c.claim_text).slice(0, 60), colored, delta]);
  }
  console.log("\n" + claimsTable.toString());

  const payoutTable = new Table({ head: ["Provider", "Matches", "Mismatches", "Unverifiable", "Outcome", "Paid / Allocated (USDC)"] });
  for (const p of job.payouts) {
    payoutTable.push([p.provider_agent_id, p.matches, p.mismatches, p.unverifiable, p.outcome, `${p.paid_usdc.toFixed(4)} / ${p.allocated_usdc.toFixed(4)}`]);
  }
  console.log("\n" + payoutTable.toString());

  const verdictColor = { accept: chalk.green, partial: chalk.yellow, reject: chalk.red }[job.overall_verdict as "accept" | "partial" | "reject"];
  console.log(`\nOVERALL VERDICT: ${verdictColor(job.overall_verdict.toUpperCase())}  |  total paid: ${job.total_paid_usdc.toFixed(4)} USDC\n`);
}

function printReputation(reputation: any[]): void {
  console.log(chalk.bold("\n=== REPUTATION DASHBOARD ===\n"));
  const table = new Table({ head: ["Provider", "Jobs", "Accepted Claims", "Mismatched", "Unverifiable", "Accuracy"] });
  for (const r of [...reputation].sort((a, b) => a.provider_agent_id.localeCompare(b.provider_agent_id))) {
    table.push([r.provider_agent_id, r.total_jobs, r.accepted_claims, r.mismatched_claims, r.unverifiable_claims, `${(r.accuracy_score * 100).toFixed(1)}%`]);
  }
  console.log(table.toString());
}

async function promptJob(rl: readline.Interface): Promise<Record<string, unknown> | null> {
  console.log(chalk.cyan("\n--- Submit a job (blank request to stop) ---"));
  const requestText = (await rl.question("Request text: ")).trim();
  if (!requestText) return null;

  let protocolSlug = "";
  while (!protocolSlug) {
    protocolSlug = (await rl.question("Protocol slug (e.g. aave, uniswap, lido, curve): ")).trim();
    if (!protocolSlug) console.log("  (required -- this is what gets looked up on DefiLlama/CoinGecko/etc.)");
  }

  let budgetUsdc = JOB_BUDGET_USDC;
  const budgetRaw = (await rl.question(`Budget USDC [${JOB_BUDGET_USDC}]: `)).trim();
  if (budgetRaw) {
    const parsed = Number(budgetRaw);
    if (Number.isFinite(parsed) && parsed > 0) budgetUsdc = parsed;
    else console.log(`  Couldn't parse '${budgetRaw}' as a positive number -- using default ${JOB_BUDGET_USDC}.`);
  }

  const targetRaw = (await rl.question(`Target address to screen [${CLEAN_DEMO_ADDRESS} clean / ${SANCTIONED_DEMO_ADDRESS} real OFAC hit / blank = clean]: `)).trim();
  const targetAddress = targetRaw || CLEAN_DEMO_ADDRESS;
  const faultRaw = (await rl.question("Inject a fault to demo the evaluator catching a lie? [none/onchain/news/compliance]: ")).trim().toLowerCase();
  const injectFault = ["onchain", "news", "compliance"].includes(faultRaw) ? faultRaw : null;

  return { request_text: requestText, budget_usdc: budgetUsdc, protocol_slug: protocolSlug, target_address: targetAddress, inject_fault: injectFault };
}

async function submitJob(payload: Record<string, unknown>): Promise<any> {
  const resp = await fetch(`${config.ORCHESTRATOR_URL}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.log(chalk.red(`job submission failed: ${resp.status} ${text}`));
    throw new Error(`job submission failed: ${resp.status}`);
  }
  return resp.json();
}

async function runDemo(): Promise<void> {
  for (const { port } of SERVICES) await waitUntilReady(port);

  console.log(chalk.green.bold("\n=== ArcProof agent-ts -- all 5 services are live ===\n"));
  console.log(`  orchestrator  : http://127.0.0.1:${config.ORCHESTRATOR_PORT}  (POST /jobs, GET /jobs/:id, GET /reputation)`);
  console.log(`  evaluator     : http://127.0.0.1:${config.EVALUATOR_PORT}`);
  console.log(`  onchain agent : http://127.0.0.1:${config.ONCHAIN_AGENT_PORT}`);
  console.log(`  news agent    : http://127.0.0.1:${config.NEWS_AGENT_PORT}`);
  console.log(`  compliance    : http://127.0.0.1:${config.COMPLIANCE_AGENT_PORT}\n`);

  if (!(await checkRealBalances())) return;

  if (process.argv.includes("--demo")) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let jobsRun = 0;
    try {
      while (true) {
        const payload = await promptJob(rl);
        if (payload === null) break;
        try {
          const job = await submitJob(payload);
          printJobResult(job);
          jobsRun++;
        } catch (e) {
          console.log(chalk.red(`job failed: ${e}`));
        }
      }
    } finally {
      rl.close();
    }

    if (jobsRun) {
      const reputation = (await (await fetch(`${config.ORCHESTRATOR_URL}/reputation`)).json()) as any[];
      printReputation(reputation);

      console.log(chalk.bold(`\n=== Real Arc testnet balances after ${jobsRun} job(s) ===\n`));
      const balances = await (await fetch(`${config.ORCHESTRATOR_URL}/wallets`)).json();
      for (const [role, bal] of Object.entries(balances as Record<string, number>).sort()) {
        console.log(`  ${role.padEnd(22)} ${bal.toFixed(6).padStart(12)} USDC`);
      }
    }
  } else {
    console.log(chalk.dim("No jobs submitted -- pass --demo to submit real jobs interactively."));
  }

  console.log(chalk.cyan.bold("\nServices are live. Submit jobs from another terminal (POST http://127.0.0.1:8000/jobs). Press Ctrl+C to stop.\n"));
}

async function main(): Promise<void> {
  await Promise.all(SERVICES.map(({ app, port }) => app.listen({ port, host: "127.0.0.1" })));
  await runDemo();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

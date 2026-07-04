/**
 * Sanctions screening against a curated, real OFAC SDN address snapshot.
 * Ported from agent/data_sources/sanctions.py.
 *
 * See ../../../fixtures/sanctioned_addresses.json for provenance. This is
 * real public data, just not a live per-request fetch -- for production,
 * swap load() to pull the full SDN list on a schedule
 * (https://ofac.treasury.gov/sanctions-list-service) instead of reading the
 * static fixture.
 */
import fs from "node:fs";
import path from "node:path";
import { FIXTURES_DIR } from "../config.js";

const FIXTURE_PATH = path.join(FIXTURES_DIR, "sanctioned_addresses.json");

interface SanctionsFixture {
  source: string;
  addresses: string[];
}

let cache: SanctionsFixture | null = null;

function load(): SanctionsFixture {
  if (!cache) {
    cache = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf-8"));
  }
  return cache!;
}

export interface SanctionsResult {
  flagged: boolean;
  source: string;
}

export async function checkSanctions(address: string): Promise<SanctionsResult> {
  const data = load();
  const addressSet = new Set(data.addresses.map((a) => a.toLowerCase()));
  return { flagged: addressSet.has(address.toLowerCase()), source: data.source };
}

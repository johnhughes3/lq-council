import type { Env } from "../types";
import { roundUsd } from "./estimate";

export interface ReserveInput {
  agentId: string;
  requestId: string;
  month: string;
  amountUsd: number;
  monthlyLimitUsd: number;
}

export interface CommitInput {
  agentId: string;
  requestId: string;
  month: string;
  actualUsd: number;
}

export interface LedgerStatus {
  agentId: string;
  month: string;
  committedUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  monthlyLimitUsd: number;
}

export interface ReserveResult {
  ok: boolean;
  status: LedgerStatus;
}

export interface CostLedger {
  reserve(input: ReserveInput): Promise<ReserveResult>;
  commit(input: CommitInput): Promise<LedgerStatus>;
  refund(input: Omit<CommitInput, "actualUsd">): Promise<LedgerStatus>;
  status(agentId: string, month: string, monthlyLimitUsd: number): Promise<LedgerStatus>;
}

export class CostLedgerUnavailableError extends Error {
  constructor() {
    super("SPEND_LEDGER Durable Object binding is required when ENVIRONMENT=production");
    this.name = "CostLedgerUnavailableError";
  }
}

export class LedgerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerInputError";
  }
}

export class LedgerStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerStateError";
  }
}

interface MonthRecord {
  committedUsd: number;
  reservations: Record<string, number>;
  commits: Record<string, number>;
  updatedAt: string;
}

const CURRENT_SCHEMA_VERSION = 1;
const AGENT_ID_RE = /^[a-z][a-z0-9-]{1,62}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_LEDGER_USD = 100_000;

export function currentMonth(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export function createCostLedger(env: Env): CostLedger {
  if (env.SPEND_LEDGER) {
    return new DurableObjectCostLedger(env.SPEND_LEDGER);
  }
  if (env.ENVIRONMENT === "production") {
    throw new CostLedgerUnavailableError();
  }
  return sharedInMemoryLedger;
}

/* v8 ignore start -- thin Cloudflare binding wrapper; ledger behavior is covered via InMemoryCostLedger. */
class DurableObjectCostLedger implements CostLedger {
  constructor(private readonly namespace: DurableObjectNamespace) {}

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    return this.send<ReserveResult>("/reserve", input);
  }

  async commit(input: CommitInput): Promise<LedgerStatus> {
    return this.send<LedgerStatus>("/commit", input);
  }

  async refund(input: Omit<CommitInput, "actualUsd">): Promise<LedgerStatus> {
    return this.send<LedgerStatus>("/refund", input);
  }

  async status(agentId: string, month: string, monthlyLimitUsd: number): Promise<LedgerStatus> {
    return this.send<LedgerStatus>("/status", { agentId, month, monthlyLimitUsd });
  }

  private async send<T>(path: string, body: unknown): Promise<T> {
    const id = this.namespace.idFromName("global-monthly-spend-ledger-v1");
    const stub = this.namespace.get(id);
    const response = await stub.fetch(`https://ledger.local${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Cost ledger failed with ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
/* v8 ignore stop */

export class InMemoryCostLedger implements CostLedger {
  private readonly records = new Map<string, MonthRecord>();

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    assertReserveInput(input);
    const record = this.getRecord(input.agentId, input.month);
    if (record.reservations[input.requestId] !== undefined) {
      return { ok: true, status: toStatus(input, record) };
    }
    if (record.commits[input.requestId] !== undefined) {
      return { ok: true, status: toStatus(input, record) };
    }

    const nextReserved = reservedUsd(record) + input.amountUsd;
    const nextTotal = record.committedUsd + nextReserved;
    if (nextTotal > input.monthlyLimitUsd) {
      return { ok: false, status: toStatus(input, record) };
    }

    record.reservations[input.requestId] = roundUsd(input.amountUsd);
    record.updatedAt = new Date().toISOString();
    return { ok: true, status: toStatus(input, record) };
  }

  async commit(input: CommitInput): Promise<LedgerStatus> {
    assertCommitInput(input);
    const record = this.getRecord(input.agentId, input.month);
    if (record.commits[input.requestId] !== undefined) {
      return toStatus({ ...input, monthlyLimitUsd: Number.POSITIVE_INFINITY }, record);
    }
    if (record.reservations[input.requestId] === undefined) {
      throw new LedgerStateError("Cannot commit spend without a matching reservation");
    }

    delete record.reservations[input.requestId];
    record.commits[input.requestId] = roundUsd(input.actualUsd);
    record.committedUsd = roundUsd(record.committedUsd + input.actualUsd);
    record.updatedAt = new Date().toISOString();
    return toStatus({ ...input, monthlyLimitUsd: Number.POSITIVE_INFINITY }, record);
  }

  async refund(input: Omit<CommitInput, "actualUsd">): Promise<LedgerStatus> {
    assertRefundInput(input);
    const record = this.getRecord(input.agentId, input.month);
    delete record.reservations[input.requestId];
    record.updatedAt = new Date().toISOString();
    return toStatus({ ...input, monthlyLimitUsd: Number.POSITIVE_INFINITY }, record);
  }

  async status(agentId: string, month: string, monthlyLimitUsd: number): Promise<LedgerStatus> {
    assertStatusInput({ agentId, month, monthlyLimitUsd });
    const record = this.getRecord(agentId, month);
    return toStatus({ agentId, month, monthlyLimitUsd }, record);
  }

  clear(): void {
    this.records.clear();
  }

  private getRecord(agentId: string, month: string): MonthRecord {
    const key = recordKey(agentId, month);
    const existing = this.records.get(key);
    if (existing) return existing;

    const record: MonthRecord = {
      committedUsd: 0,
      reservations: {},
      commits: {},
      updatedAt: new Date().toISOString(),
    };
    this.records.set(key, record);
    return record;
  }
}

export const sharedInMemoryLedger = new InMemoryCostLedger();

/* v8 ignore start -- Durable Object runtime wrapper; shared ledger semantics are covered in unit tests. */
export class MonthlySpendLedger {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    void this.env;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    const url = new URL(request.url);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return json({ error: "invalid_json" }, 400);
    }

    try {
      if (url.pathname === "/reserve") {
        return json(await this.reserve(body as unknown as ReserveInput));
      }
      if (url.pathname === "/commit") {
        return json(await this.commit(body as unknown as CommitInput));
      }
      if (url.pathname === "/refund") {
        return json(await this.refund(body as unknown as Omit<CommitInput, "actualUsd">));
      }
      if (url.pathname === "/status") {
        const { agentId, month, monthlyLimitUsd } = body as {
          agentId: string;
          month: string;
          monthlyLimitUsd: number;
        };
        return json(await this.status(agentId, month, monthlyLimitUsd));
      }
    } catch (error) {
      if (error instanceof LedgerInputError) {
        return json({ error: "invalid_ledger_input" }, 400);
      }
      if (error instanceof LedgerStateError) {
        return json({ error: "invalid_ledger_state" }, 409);
      }
      throw error;
    }

    return json({ error: "not_found" }, 404);
  }

  private async reserve(input: ReserveInput): Promise<ReserveResult> {
    assertReserveInput(input);
    const record = await this.load(input.agentId, input.month);
    if (record.reservations[input.requestId] !== undefined) {
      return { ok: true, status: toStatus(input, record) };
    }
    if (record.commits[input.requestId] !== undefined) {
      return { ok: true, status: toStatus(input, record) };
    }

    const nextReserved = reservedUsd(record) + input.amountUsd;
    const nextTotal = record.committedUsd + nextReserved;
    if (nextTotal > input.monthlyLimitUsd) {
      return { ok: false, status: toStatus(input, record) };
    }

    record.reservations[input.requestId] = roundUsd(input.amountUsd);
    record.updatedAt = new Date().toISOString();
    await this.save(input.agentId, input.month, record);
    return { ok: true, status: toStatus(input, record) };
  }

  private async commit(input: CommitInput): Promise<LedgerStatus> {
    assertCommitInput(input);
    const record = await this.load(input.agentId, input.month);
    if (record.commits[input.requestId] !== undefined) {
      return toStatus({ ...input, monthlyLimitUsd: Number.POSITIVE_INFINITY }, record);
    }
    if (record.reservations[input.requestId] === undefined) {
      throw new LedgerStateError("Cannot commit spend without a matching reservation");
    }

    delete record.reservations[input.requestId];
    record.commits[input.requestId] = roundUsd(input.actualUsd);
    record.committedUsd = roundUsd(record.committedUsd + input.actualUsd);
    record.updatedAt = new Date().toISOString();
    await this.save(input.agentId, input.month, record);
    return toStatus({ ...input, monthlyLimitUsd: Number.POSITIVE_INFINITY }, record);
  }

  private async refund(input: Omit<CommitInput, "actualUsd">): Promise<LedgerStatus> {
    assertRefundInput(input);
    const record = await this.load(input.agentId, input.month);
    delete record.reservations[input.requestId];
    record.updatedAt = new Date().toISOString();
    await this.save(input.agentId, input.month, record);
    return toStatus({ ...input, monthlyLimitUsd: Number.POSITIVE_INFINITY }, record);
  }

  private async status(
    agentId: string,
    month: string,
    monthlyLimitUsd: number,
  ): Promise<LedgerStatus> {
    assertStatusInput({ agentId, month, monthlyLimitUsd });
    const record = await this.load(agentId, month);
    return toStatus({ agentId, month, monthlyLimitUsd }, record);
  }

  private async load(agentId: string, month: string): Promise<MonthRecord> {
    const key = recordKey(agentId, month);
    const record = await this.state.storage.get<MonthRecord>(key);
    return (
      record ?? {
        committedUsd: 0,
        reservations: {},
        commits: {},
        updatedAt: new Date().toISOString(),
      }
    );
  }

  private async save(agentId: string, month: string, record: MonthRecord): Promise<void> {
    await this.state.storage.put(recordKey(agentId, month), {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      ...record,
    });
  }
}
/* v8 ignore stop */

function reservedUsd(record: MonthRecord): number {
  return roundUsd(Object.values(record.reservations).reduce((sum, value) => sum + value, 0));
}

function toStatus(
  input: Pick<ReserveInput, "agentId" | "month" | "monthlyLimitUsd">,
  record: MonthRecord,
): LedgerStatus {
  const reserved = reservedUsd(record);
  return {
    agentId: input.agentId,
    month: input.month,
    committedUsd: roundUsd(record.committedUsd),
    reservedUsd: reserved,
    remainingUsd: roundUsd(Math.max(0, input.monthlyLimitUsd - record.committedUsd - reserved)),
    monthlyLimitUsd: input.monthlyLimitUsd,
  };
}

function recordKey(agentId: string, month: string): string {
  return `ledger:${agentId}:${month}`;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function assertReserveInput(input: ReserveInput): void {
  assertAgentId(input.agentId);
  assertRequestId(input.requestId);
  assertMonth(input.month);
  assertUsd(input.amountUsd, "amountUsd");
  assertUsd(input.monthlyLimitUsd, "monthlyLimitUsd");
}

function assertCommitInput(input: CommitInput): void {
  assertAgentId(input.agentId);
  assertRequestId(input.requestId);
  assertMonth(input.month);
  assertUsd(input.actualUsd, "actualUsd");
}

function assertRefundInput(input: Omit<CommitInput, "actualUsd">): void {
  assertAgentId(input.agentId);
  assertRequestId(input.requestId);
  assertMonth(input.month);
}

function assertStatusInput(input: {
  agentId: string;
  month: string;
  monthlyLimitUsd: number;
}): void {
  assertAgentId(input.agentId);
  assertMonth(input.month);
  assertUsd(input.monthlyLimitUsd, "monthlyLimitUsd");
}

function assertAgentId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !AGENT_ID_RE.test(value)) {
    throw new LedgerInputError("Invalid ledger input: agentId");
  }
}

function assertRequestId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !REQUEST_ID_RE.test(value)) {
    throw new LedgerInputError("Invalid ledger input: requestId");
  }
}

function assertMonth(value: unknown): asserts value is string {
  if (typeof value !== "string" || !MONTH_RE.test(value)) {
    throw new LedgerInputError("Invalid ledger input: month");
  }
}

function assertUsd(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_LEDGER_USD) {
    throw new LedgerInputError(`Invalid ledger input: ${field}`);
  }
}

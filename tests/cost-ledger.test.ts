import { beforeEach, describe, expect, it } from "vitest";
import {
  CostLedgerUnavailableError,
  createCostLedger,
  currentMonth,
  InMemoryCostLedger,
  LedgerInputError,
  LedgerStateError,
  MonthlySpendLedger,
} from "../src/cost/ledger";

describe("cost ledger", () => {
  let ledger: InMemoryCostLedger;
  const month = currentMonth(new Date("2026-04-24T12:00:00Z"));

  beforeEach(() => {
    ledger = new InMemoryCostLedger();
  });

  it("reserves, commits, and exposes remaining budget", async () => {
    const reserve = await ledger.reserve({
      agentId: "scalia",
      requestId: "req-1",
      month,
      amountUsd: 1.25,
      monthlyLimitUsd: 5,
    });
    expect(reserve.ok).toBe(true);
    expect(reserve.status.reservedUsd).toBe(1.25);

    const committed = await ledger.commit({
      agentId: "scalia",
      requestId: "req-1",
      month,
      actualUsd: 0.5,
    });
    expect(committed.committedUsd).toBe(0.5);
    expect(committed.reservedUsd).toBe(0);
  });

  it("blocks spend that would exceed the monthly limit including reservations", async () => {
    await ledger.reserve({
      agentId: "scalia",
      requestId: "req-1",
      month,
      amountUsd: 4,
      monthlyLimitUsd: 5,
    });

    const blocked = await ledger.reserve({
      agentId: "scalia",
      requestId: "req-2",
      month,
      amountUsd: 2,
      monthlyLimitUsd: 5,
    });

    expect(blocked.ok).toBe(false);
    expect(blocked.status.reservedUsd).toBe(4);
    expect(blocked.status.remainingUsd).toBe(1);
  });

  it("refunds failed calls so reservations are not lost", async () => {
    await ledger.reserve({
      agentId: "kagan",
      requestId: "req-failed",
      month,
      amountUsd: 3,
      monthlyLimitUsd: 5,
    });

    const afterRefund = await ledger.refund({
      agentId: "kagan",
      requestId: "req-failed",
      month,
    });

    expect(afterRefund.committedUsd).toBe(0);
    expect(afterRefund.reservedUsd).toBe(0);
    expect(afterRefund.remainingUsd).toBe(Number.POSITIVE_INFINITY);

    const status = await ledger.status("kagan", month, 5);
    expect(status.remainingUsd).toBe(5);
  });

  it("does not double-commit the same internal reservation", async () => {
    await ledger.reserve({
      agentId: "scalia",
      requestId: "req-1",
      month,
      amountUsd: 1,
      monthlyLimitUsd: 5,
    });
    await ledger.commit({ agentId: "scalia", requestId: "req-1", month, actualUsd: 0.75 });
    await ledger.commit({ agentId: "scalia", requestId: "req-1", month, actualUsd: 0.75 });
    const status = await ledger.status("scalia", month, 5);
    expect(status.committedUsd).toBe(0.75);
  });

  it("does not commit spend without a matching reservation", async () => {
    await expect(
      ledger.commit({
        agentId: "scalia",
        requestId: "missing-reservation",
        month,
        actualUsd: 0.75,
      }),
    ).rejects.toThrow(LedgerStateError);

    const status = await ledger.status("scalia", month, 5);
    expect(status.committedUsd).toBe(0);
    expect(status.reservedUsd).toBe(0);
  });

  it("does not use the process-local fallback ledger in production", () => {
    expect(() => createCostLedger({ ENVIRONMENT: "production" })).toThrow(
      CostLedgerUnavailableError,
    );
  });

  it("rejects malformed ledger mutations before state changes", async () => {
    await expect(
      ledger.reserve({
        agentId: "../scalia",
        requestId: "req-1",
        month,
        amountUsd: 1,
        monthlyLimitUsd: 5,
      }),
    ).rejects.toThrow(LedgerInputError);

    await expect(
      ledger.commit({
        agentId: "scalia",
        requestId: "req-1",
        month,
        actualUsd: Number.NaN,
      }),
    ).rejects.toThrow(LedgerInputError);

    await expect(ledger.status("scalia", "2026-99", 5)).rejects.toThrow(LedgerInputError);
  });

  it("returns 400 for invalid Durable Object ledger input", async () => {
    const durableObject = new MonthlySpendLedger(fakeDurableObjectState(), {});
    const response = await durableObject.fetch(
      new Request("https://ledger.local/reserve", {
        method: "POST",
        body: JSON.stringify({
          agentId: "scalia",
          requestId: "req-1",
          month,
          amountUsd: Number.POSITIVE_INFINITY,
          monthlyLimitUsd: 5,
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_ledger_input" });
  });

  it("returns 409 for invalid Durable Object ledger state transitions", async () => {
    const durableObject = new MonthlySpendLedger(fakeDurableObjectState(), {});
    const response = await durableObject.fetch(
      new Request("https://ledger.local/commit", {
        method: "POST",
        body: JSON.stringify({
          agentId: "scalia",
          requestId: "missing-reservation",
          month,
          actualUsd: 0.5,
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "invalid_ledger_state" });
  });
});

function fakeDurableObjectState(): DurableObjectState {
  const storage = new Map<string, unknown>();
  return {
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
    },
  } as unknown as DurableObjectState;
}

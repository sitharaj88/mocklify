import { describe, it, expect } from 'vitest';
import { clampMissionBudgets, type SurfaceMission } from '../src/ai/agent/scanGraph';
import {
  AGENT_MAX_TOOL_CALLS,
  MAX_TOOL_CALLS_CAP,
  MULTI_PROJECT_READ_BUDGET_BYTES,
  SCAN_BUDGET_CAP_MS,
} from '../src/ai/AgenticScanner';

function mission(overrides: Partial<SurfaceMission>): SurfaceMission {
  return {
    name: 'app',
    direction: 'consumes',
    prompt: 'explore',
    reconFirst: false,
    seedSection: '',
    groupSurfaces: [{ name: 'app', direction: 'consumes', rootPath: '' }],
    maxToolCalls: 30,
    budgetMs: 60_000,
    readBudgetBytes: 512 * 1024,
    ...overrides,
  } as SurfaceMission;
}

/**
 * Missions round-trip through checkpoint files on disk, so their budgets are
 * untrusted input on resume: a tampered checkpoint must not buy an unbounded
 * tool-call, wall-clock, or read budget.
 */
describe('clampMissionBudgets', () => {
  it('passes legitimate budgets through unchanged', () => {
    const original = mission({ maxToolCalls: 45, budgetMs: 600_000, readBudgetBytes: 512 * 1024 });
    const clamped = clampMissionBudgets(original);
    expect(clamped.maxToolCalls).toBe(45);
    expect(clamped.budgetMs).toBe(600_000);
    expect(clamped.readBudgetBytes).toBe(512 * 1024);
  });

  it('caps budgets inflated by a tampered checkpoint', () => {
    const clamped = clampMissionBudgets(
      mission({
        maxToolCalls: 100_000,
        budgetMs: 24 * 60 * 60_000,
        readBudgetBytes: 5_000_000_000,
      })
    );
    expect(clamped.maxToolCalls).toBe(MAX_TOOL_CALLS_CAP);
    expect(clamped.budgetMs).toBe(SCAN_BUDGET_CAP_MS);
    expect(clamped.readBudgetBytes).toBe(MULTI_PROJECT_READ_BUDGET_BYTES);
  });

  it('floors non-positive budgets rather than disabling the limits', () => {
    const clamped = clampMissionBudgets(
      mission({ maxToolCalls: 0, budgetMs: -1, readBudgetBytes: 0 })
    );
    expect(clamped.maxToolCalls).toBe(1);
    expect(clamped.budgetMs).toBe(1_000);
    expect(clamped.readBudgetBytes).toBe(1_024);
  });

  it('replaces non-numeric budgets with safe defaults', () => {
    const clamped = clampMissionBudgets(
      mission({
        maxToolCalls: Number.NaN,
        budgetMs: Number.POSITIVE_INFINITY,
        readBudgetBytes: 'lots' as unknown as number,
      })
    );
    expect(clamped.maxToolCalls).toBe(AGENT_MAX_TOOL_CALLS);
    expect(clamped.budgetMs).toBe(SCAN_BUDGET_CAP_MS);
    expect(clamped.readBudgetBytes).toBe(MULTI_PROJECT_READ_BUDGET_BYTES);
  });

  it('preserves the mission identity fields', () => {
    const clamped = clampMissionBudgets(mission({ name: 'server', direction: 'serves' }));
    expect(clamped.name).toBe('server');
    expect(clamped.direction).toBe('serves');
    expect(clamped.prompt).toBe('explore');
  });
});

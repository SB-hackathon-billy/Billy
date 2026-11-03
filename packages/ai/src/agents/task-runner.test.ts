import { describe, expect, it, vi } from 'vitest';
import { AI_FIXTURES, portsFromTransport, type AgentDiagnostic } from '../index.js';

describe('agent execution boundary', () => {
  it('rejects invalid input before the model, even for fallback roles', async () => {
    const execute = vi.fn();
    const task = structuredClone(AI_FIXTURES.RECOMMEND_FEE.input);
    task.taskId = '';
    await expect(portsFromTransport({ execute }).runTask(task)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it('logs fixed outcomes without recording speech, provider errors or results', async () => {
    const events: AgentDiagnostic[] = [];
    const ports = portsFromTransport(
      {
        execute: async () => {
          throw new Error('secret-provider-text');
        },
      },
      { onDiagnostic: (event) => events.push(event) },
    );
    expect(await ports.runTask(AI_FIXTURES.RECOMMEND_FEE.input)).toBeNull();
    expect(await ports.runTask(AI_FIXTURES.ROUTE_INTENT.input)).toMatchObject({
      result: { intent: 'UNCLEAR' },
    });
    await expect(ports.runTask(AI_FIXTURES.EXTRACT_NEED.input)).rejects.toThrow(
      'secret-provider-text',
    );
    expect(events.map((e) => e.outcome)).toEqual(['FALLBACK', 'FALLBACK', 'FAILED']);
    expect(events.every((e) => e.boundary === 'MODEL' && !!e.promptVersion)).toBe(true);
    expect(JSON.stringify(events)).not.toContain('secret-provider-text');
    expect(events[0]).not.toHaveProperty('input');
  });
  it('separates invalid results from provider failures, and ignores observer exceptions', async () => {
    const onDiagnostic = vi.fn(() => {
      throw new Error('observer');
    });
    const task = AI_FIXTURES.EXTRACT_NEED.input;
    const ports = portsFromTransport(
      { execute: async () => ({ ...AI_FIXTURES.EXTRACT_NEED.output, taskId: 'task_other' }) },
      { onDiagnostic },
    );
    await expect(ports.runTask(task)).rejects.toThrow('REFERENCE_MISMATCH');
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ boundary: 'RESULT', outcome: 'FAILED' }),
    );
    const valid = portsFromTransport(
      { execute: async () => AI_FIXTURES.EXTRACT_NEED.output },
      { onDiagnostic },
    );
    expect(await valid.runTask(task)).toEqual(AI_FIXTURES.EXTRACT_NEED.output);
  });
});

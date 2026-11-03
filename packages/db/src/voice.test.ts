import { it, expect } from 'vitest';
import { AiTaskInputSchema, createEmptyNeed } from '@sb/contracts';
import { defaultRequestPeriod } from '@sb/demo-data';

it('finishes a call once, persists the form then searches in the worker; stale results cannot overwrite edits', async () => {
  const now = new Date('2026-11-01T01:00:00Z');
  const { db, cleanup } = await createTestDatabase({ now: () => now });
  try {
    const v = await db.transaction((u) => u.create('u_hana', createEmptyNeed()));
    const body = {
      requestId: v.request.id,
      expectedRequestVersion: 1,
      text: '드라이버가 필요해요',
    };
    const accepted = await db.transaction((u) => u.finishVoice('u_hana', body, 'voice_end'));
    expect(await db.transaction((u) => u.finishVoice('u_hana', body, 'voice_end'))).toEqual(
      accepted,
    );
    const task = (await db.startTask(accepted.taskId))!;
    expect(AiTaskInputSchema.safeParse(await db.getTaskInput(task.id)).success).toBe(true);
    expect((await db.transaction((u) => u.getRequest('u_hana', v.request.id))).request.status).toBe(
      'DRAFT',
    );
    await db.recordTaskResult(task.id, task.inputVersion, {
      proposedNeed: {
        category: 'TOOLS',
        queryText: '드라이버',
        ...defaultRequestPeriod(now),
        preferredPlaceIds: ['place-center'],
        maxBudgetKrw: null,
      },
      missingFields: [],
      clarificationQuestion: null,
    });
    const saved = await db.transaction((u) => u.getRequest('u_hana', v.request.id));
    expect(saved.request.status).toBe('SEARCHING');
    expect(saved.request.need.queryText).toBe('드라이버');
    expect(saved.negotiations).toEqual([]);
    expect((await db.getTaskInput(task.id))?.context).not.toHaveProperty('text');
    expect(
      await db.recordTaskResult(task.id, task.inputVersion, (await db.getTask(task.id)).result!),
    ).toBe(false);
    const search = saved.tasks.find((task) => task.kind === 'SEARCH')!;
    await db.runSearch(v.request.id, search.inputVersion);
    expect((await db.transaction((u) => u.getRequest('u_hana', v.request.id))).request.status).toBe(
      'NO_MATCH',
    );

    const other = await db.transaction((u) => u.create('u_hana', createEmptyNeed()));
    const final = await db.transaction((u) =>
      u.finishVoice('u_hana', { ...body, requestId: other.request.id }, 'voice_stale'),
    );
    const stale = (await db.startTask(final.taskId))!;
    await db.transaction((u) =>
      u.patchDraft('u_hana', other.request.id, {
        expectedRequestVersion: 1,
        need: { ...createEmptyNeed(), queryText: '청소기' },
      }),
    );
    expect(
      await db.recordTaskResult(stale.id, stale.inputVersion, {
        proposedNeed: createEmptyNeed(),
        missingFields: ['queryText'],
        clarificationQuestion: '물품?',
      }),
    ).toBe(false);
    expect(
      (await db.transaction((u) => u.getRequest('u_hana', other.request.id))).request.need
        .queryText,
    ).toBe('청소기');
  } finally {
    await cleanup();
  }
});
import { createTestDatabase } from './testing.js';

it('scrubs only marked voice turns, preserves results/text turns, and prevents late copies after expiry', async () => {
  let now = new Date('2026-11-01T01:00:00Z');
  const { db, cleanup } = await createTestDatabase({ now: () => now });
  try {
    const view = await db.transaction((u) => u.create('u_hana', createEmptyNeed()));
    const body = {
      requestId: view.request.id,
      expectedRequestVersion: 1,
      text: '프로젝터 음성 원문',
    };
    const route = await db.transaction((u) =>
      u.agentTurn('u_hana', body, { voiceSessionId: 'voice_privacy' }),
    );
    const input = await db.getTaskInput(route.taskId);
    expect(AiTaskInputSchema.safeParse(input).success).toBe(true);
    expect(input?.context).not.toHaveProperty('voiceSessionId');
    const task = (await db.startTask(route.taskId))!;
    await db.recordTaskResult(task.id, task.inputVersion, { intent: 'RENTAL_REQUEST' });
    const extraction = (await db.sync('u_hana')).tasks.find((t) => t.kind === 'EXTRACT_NEED')!;
    expect(AiTaskInputSchema.safeParse(await db.getTaskInput(extraction.id)).success).toBe(true);
    await db.startTask(extraction.id);
    await db.recordTaskResult(extraction.id, extraction.inputVersion, {
      proposedNeed: { ...createEmptyNeed(), queryText: '프로젝터' },
      missingFields: ['category', 'startAt', 'endAt', 'preferredPlaceIds'],
      clarificationQuestion: '날짜를 알려 주세요.',
    });
    const text = await db.transaction((u) =>
      u.agentTurn('u_hana', { ...body, text: '보존할 텍스트 입력' }),
    );
    expect(task.inputVersion.kind).toBe('TURN');
    if (task.inputVersion.kind !== 'TURN') throw new Error('Expected turn');
    expect(await db.scrubVoiceTurnText({ turnIds: [task.inputVersion.turnId] })).toBe(2);
    expect((await db.getTaskInput(task.id))?.context).not.toHaveProperty('text');
    expect((await db.getTaskInput(extraction.id))?.context).not.toHaveProperty('text');
    expect((await db.getTask(extraction.id)).result).toMatchObject({
      proposedNeed: { queryText: '프로젝터' },
    });
    expect((await db.getTaskInput(text.taskId))?.context).toMatchObject({
      text: '보존할 텍스트 입력',
    });
    expect(await db.startTask(text.taskId)).not.toBeNull();
    const crash = await db.transaction((u) =>
      u.agentTurn('u_hana', body, { voiceSessionId: 'voice_crash' }),
    );
    const running = (await db.startTask(crash.taskId))!;
    now = new Date(now.getTime() + 615_000);
    expect(await db.scrubVoiceTurnText()).toBe(1);
    expect(
      await db.recordTaskResult(running.id, running.inputVersion, { intent: 'RENTAL_REQUEST' }),
    ).toBe(false);
    expect((await db.getTaskInput(running.id))?.context).not.toHaveProperty('text');
    expect(
      (await db.transaction((u) => u.getRequest('u_hana', view.request.id))).request,
    ).toMatchObject({ status: 'DRAFT', version: 1 });
  } finally {
    await cleanup();
  }
});

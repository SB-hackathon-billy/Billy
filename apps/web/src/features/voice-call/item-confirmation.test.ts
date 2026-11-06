import { describe, expect, it } from 'vitest';
import { createEmptyNeed } from '@sb/contracts';
import { hasCurrentVoiceCompletion, itemConfirmationKey } from './item-confirmation.js';

describe('voice item confirmation', () => {
  const item = { ...createEmptyNeed(), category: 'TRAVEL' as const, queryText: '캐리어' };

  it('only offers confirmation for an identified item', () => {
    expect(itemConfirmationKey(createEmptyNeed())).toBeNull();
    expect(itemConfirmationKey({ ...item, queryText: '  ' })).toBeNull();
    expect(itemConfirmationKey({ ...item, category: null })).toBeNull();
    expect(itemConfirmationKey(item)).not.toBeNull();
  });

  it('requires a new confirmation when the item or its category changes', () => {
    const confirmed = itemConfirmationKey(item);
    expect(itemConfirmationKey({ ...item, queryText: '텐트' })).not.toBe(confirmed);
    expect(itemConfirmationKey({ ...item, category: 'HOBBY' })).not.toBe(confirmed);
  });

  it('keeps confirmation when only dates, places, budget or surrounding spaces change', () => {
    expect(
      itemConfirmationKey({
        ...item,
        queryText: ' 캐리어 ',
        startAt: '2026-11-07T01:00:00Z',
        preferredPlaceIds: ['place-center'],
        maxBudgetKrw: 10000,
      }),
    ).toBe(itemConfirmationKey(item));
  });
});

describe('voice approval freshness', () => {
  const completion = { taskId: 'task_new', inputRevision: 3, requestVersion: 1 };

  it('requires the displayed task to be the completed extraction for the current input', () => {
    expect(hasCurrentVoiceCompletion({ inputRevision: 3, completion }, 'task_new')).toBe(true);
    expect(hasCurrentVoiceCompletion({ inputRevision: 3, completion }, 'task_old')).toBe(false);
    expect(hasCurrentVoiceCompletion({ inputRevision: 4, completion }, 'task_new')).toBe(false);
  });

  it('rejects an unobserved old result returned while a correction is still extracting', () => {
    // Server may expose task B after the client last observed A, but clears completion on input C.
    expect(hasCurrentVoiceCompletion({ inputRevision: 4, completion: null }, 'task_B')).toBe(false);
    expect(hasCurrentVoiceCompletion(null, 'task_B')).toBe(false);
  });
});

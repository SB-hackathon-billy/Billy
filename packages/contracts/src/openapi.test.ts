import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_OPERATIONS, buildOpenApi } from './openapi.js';

describe('OpenAPI from contracts', () => {
  it('matches the committed OpenAPI artifact from the current schemas', () => {
    // Update the artifact with `npm run openapi` when the executable contract changes.
    // Historical MVP prose is not an input to current contract verification.
    const committed = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
    expect(buildOpenApi()).toEqual(committed);
  });
  it('has resolvable schema references, strict bodies, and secured mutations', () => {
    const spec = buildOpenApi();
    const names = new Set(Object.keys(spec.components.schemas));
    for (const match of JSON.stringify(spec).matchAll(/#\/components\/schemas\/([^"\\]+)/g))
      expect(names.has(match[1]!)).toBe(true);
    for (const operation of API_OPERATIONS) {
      const entry = spec.paths[operation.path]![operation.method] as {
        parameters: { name: string }[];
        responses: Record<string, unknown>;
      };
      expect(entry.responses).toHaveProperty(String(operation.status));
      if (operation.method !== 'get' && !operation.public)
        expect(entry.parameters.map((parameter) => parameter.name)).toEqual(
          expect.arrayContaining(['X-CSRF-Token', 'Idempotency-Key']),
        );
      if (operation.body) {
        const body = spec.components.schemas[operation.body]!;
        if (body.type === 'object') expect(body.additionalProperties).toBe(false);
        else
          for (const option of body.anyOf ?? body.oneOf ?? [])
            expect((option as { additionalProperties: boolean }).additionalProperties).toBe(false);
      }
    }
  });
});

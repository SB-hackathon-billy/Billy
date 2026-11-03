import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_OPERATIONS, buildOpenApi } from './openapi.js';

describe('OpenAPI from contracts', () => {
  it('covers exactly every method/path from contract §6.1', () => {
    const document = readFileSync(
      new URL('../../../docs/COMMON_CONTRACT.md', import.meta.url),
      'utf8',
    );
    const section = document.split('### 6.1 endpoint 목록')[1]!.split('### 6.2')[0]!;
    const expected = [...section.matchAll(/\| (GET|POST|PATCH|DELETE) `([^`]+)`/g)]
      .map(([, method, path]) => `${method} ${path!.replace(':id', '{id}')}`)
      .sort();
    expect(expected).toHaveLength(31);
    expect(
      API_OPERATIONS.map(
        (operation) => `${operation.method.toUpperCase()} ${operation.path}`,
      ).sort(),
    ).toEqual(expected);
    const spec = buildOpenApi();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.version).toBe('0.3.0');
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

import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import {
  AssetMetadataSchema,
  CENTER_CONTENT_TYPE_VALUES,
  CenterContentSchema,
  CONTRACT_VERSION,
} from '@sb/contracts';
import catalog from '../../../public/content/center/v1/catalog.json';
import bundledCatalog from './catalog.generated.json';
import { illustrationManifest } from '../../assets/illustrations/manifest.js';
import { categories, centerContent, filterCenterContent } from './content.js';
import { validateSpaceDraft } from './forms.js';

describe('versioned center public content', () => {
  it('validates every base object using the strict shared contract', () => {
    expect(bundledCatalog).toEqual(catalog);
    expect(catalog.contractVersion).toBe(CONTRACT_VERSION);
    expect(catalog.contentVersion).toMatch(/^\d+\.\d+\.\d+$/);
    for (const { content } of catalog.items) {
      expect(CenterContentSchema.safeParse(content).success, content.id).toBe(true);
      expect(content.isDemo, content.id).toBe(true);
      expect(new URL(content.sourceUrl).hostname).toBe('sb1in.or.kr');
    }
    expect(new Set(centerContent.map((item) => item.id)).size).toBe(centerContent.length);
    expect(new Set(centerContent.map((item) => item.type))).toEqual(
      new Set(CENTER_CONTENT_TYPE_VALUES),
    );
  });
  it('keeps meaningful static program, club and space display extensions', () => {
    const programs = centerContent.filter((item) => item.type === 'PROGRAM');
    expect(new Set(programs.map((item) => item.display.category))).toEqual(new Set(categories));
    for (const { display } of programs) {
      expect(Date.parse(display.endAt)).toBeGreaterThan(Date.parse(display.startAt));
      expect(display.audience).not.toBe('');
      expect(display.venue).not.toBe('');
      expect(display.process).not.toBe('');
    }
    expect(
      new Set(
        centerContent.filter((item) => item.type === 'CLUB').map((item) => item.display.status),
      ),
    ).toEqual(new Set(['모집', '활동']));
    for (const item of centerContent.filter((entry) => entry.type === 'SPACE'))
      expect(item.display.capacity).toBeGreaterThan(0);
  });
  it('resolves every image locally and identifies synthetic illustrations', () => {
    for (const { content } of catalog.items)
      for (const image of content.images) {
        expect(image.url).toMatch(/^\/content\/center\/v1\/[a-z-]+\.svg$/);
        expect(image.isIllustration).toBe(true);
        expect(image.alt.length).toBeGreaterThan(0);
        expect(
          statSync(new URL(`../../../public${image.url}`, import.meta.url)).size,
        ).toBeGreaterThan(0);
      }
  });
  it('validates all asset metadata and exact byte sizes', () => {
    for (const asset of illustrationManifest) {
      expect(AssetMetadataSchema.safeParse(asset).success, asset.id).toBe(true);
      const svg = new URL(`../../assets/illustrations/${asset.id}.svg`, import.meta.url);
      expect(statSync(svg).size).toBe(asset.byteSize);
      expect(readFileSync(svg, 'utf8')).not.toMatch(/https?:\/\/(?!www.w3.org\/2000\/svg)/);
    }
    expect(illustrationManifest.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'sharing-home',
        'cleaning',
        'tools',
        'travel',
        'hobby',
        'empty',
        'waiting',
        'comparison',
      ]),
    );
  });
});

describe('center discovery and preview boundaries', () => {
  it('combines Korean search, category, weekday, status and Seoul date filters', () => {
    const programs = centerContent.filter((item) => item.type === 'PROGRAM');
    expect(
      filterCenterContent(programs, '  작은 습관  ', {
        category: '심리 정서 지원',
        weekday: '토',
        status: '모집 예시',
        date: '2026-11-07',
      }).map((item) => item.id),
    ).toEqual(['program-mind']);
    expect(filterCenterContent(programs, '', { weekday: '월' })).toEqual([]);
    expect(filterCenterContent(programs, '존재하지않는프로그램')).toEqual([]);
    expect(filterCenterContent(programs, '')).toHaveLength(5);
  });
  it('uses the Seoul date when an event is on the preceding UTC day', () => {
    const first = centerContent.find((item) => item.type === 'PROGRAM')!;
    const midnight = { ...first, display: { ...first.display, startAt: '2026-11-06T15:30:00Z' } };
    expect(filterCenterContent([midnight], '', { date: '2026-11-07', weekday: '토' })).toHaveLength(
      1,
    );
  });
  it('rejects reversed, equal or incomplete preview times', () => {
    const valid = {
      date: '2026-11-07',
      start: '10:00',
      end: '12:00',
      people: '2',
      purpose: '독서 모임 예시',
    };
    expect(validateSpaceDraft(valid)).toBe('');
    expect(validateSpaceDraft({ ...valid, end: '10:00' })).toContain('종료 시간');
    expect(validateSpaceDraft({ ...valid, end: '09:00' })).toContain('종료 시간');
    expect(validateSpaceDraft({ ...valid, purpose: ' ' })).toContain('입력');
  });
});

import { describe, expect, it } from 'vitest';
import { CAMPUS_HUB_PLACE_IDS } from '@sb/contracts';
import {
  CENTER_SPOT,
  HUB_SPOTS,
  SEONGBUK_MAP,
  distanceMeters,
  formatDistance,
  project,
  walkMinutes,
} from './campus.js';

describe('캠퍼스 거점 거리', () => {
  it('모든 거점에 좌표가 있다', () => {
    for (const id of CAMPUS_HUB_PLACE_IDS) expect(HUB_SPOTS[id], id).toBeDefined();
  });
  it('한성대–성신여대는 약 1.4km, 같은 지점은 0m', () => {
    const d = distanceMeters(HUB_SPOTS['place-hansung']!, HUB_SPOTS['place-sungshin']!);
    expect(d).toBeGreaterThan(1_000);
    expect(d).toBeLessThan(1_600);
    expect(distanceMeters(HUB_SPOTS['place-korea']!, HUB_SPOTS['place-korea']!)).toBe(0);
  });
  it('거리·도보 시간 표시', () => {
    expect(formatDistance(643)).toBe('640m');
    expect(formatDistance(1_349)).toBe('1.3km');
    expect(walkMinutes(670)).toBe(13);
    expect(walkMinutes(10)).toBe(1);
  });
  it('거점을 성북구 지도 안쪽에 찍는다', () => {
    for (const spot of [...Object.values(HUB_SPOTS), CENTER_SPOT]) {
      const p = project(spot);
      expect(p.x).toBeGreaterThan(0);
      expect(p.y).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(SEONGBUK_MAP.width);
      expect(p.y).toBeLessThan(SEONGBUK_MAP.height);
    }
  });
});

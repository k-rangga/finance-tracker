/**
 * Unit tests for src/lib/atmosphere.ts: weather mapping, seasonal windows, and warm first-person copy.
 * Run with `npm run test:atmosphere`.
 */
import assert from 'node:assert/strict';
import { ATMOSPHERE_PRESETS, detectSeason, isPaydayWindow, resolveAtmosphere, weatherFromWmo } from './atmosphere.js';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('ok  ', name);
};

test('detectSeason honors Christmas (-14d), New Year, Independence Day, and Summer', () => {
  assert.equal(detectSeason(new Date(2026, 11, 10, 12), 'sunny'), 'none');
  assert.equal(detectSeason(new Date(2026, 11, 11, 12), 'sunny'), 'christmas');
  assert.equal(detectSeason(new Date(2026, 11, 25, 12), 'rain'), 'christmas');
  assert.equal(detectSeason(new Date(2026, 11, 26, 12), 'sunny'), 'none');

  assert.equal(detectSeason(new Date(2026, 11, 31, 20), 'night'), 'newyear');
  assert.equal(detectSeason(new Date(2027, 0, 1, 10), 'sunny'), 'newyear');
  assert.equal(detectSeason(new Date(2027, 0, 2, 10), 'sunny'), 'newyear');
  assert.equal(detectSeason(new Date(2027, 0, 3, 10), 'sunny'), 'none');

  assert.equal(detectSeason(new Date(2026, 7, 17, 10), 'sunny'), 'independence');
  assert.equal(detectSeason(new Date(2026, 5, 15, 10), 'cloudy'), 'summer');
  assert.equal(detectSeason(new Date(2026, 2, 15, 13), 'sunny', 32), 'summer');
  assert.equal(detectSeason(new Date(2026, 2, 15, 13), 'rain', 26), 'none');
});

test('weatherFromWmo maps WMO codes and hour fallback accurately', () => {
  assert.equal(weatherFromWmo(95, 14, true), 'storm');
  assert.equal(weatherFromWmo(63, 14, true), 'rain');
  assert.equal(weatherFromWmo(3, 14, true), 'cloudy');
  assert.equal(weatherFromWmo(0, 14, true), 'sunny');
  assert.equal(weatherFromWmo(0, 17, true), 'sunset');
  assert.equal(weatherFromWmo(0, 21, false), 'night');
  assert.equal(weatherFromWmo(null, 2, null), 'night');
});

test('resolveAtmosphere uses warm home-first copy without place names and covers all presets', () => {
  for (const preset of ATMOSPHERE_PRESETS) {
    const out = resolveAtmosphere({
      date: new Date(2026, 10, 20, 14),
      weatherCode: 61,
      tempC: 27,
      isDay: true,
      preset,
    });
    assert.ok(out.whisper.length > 0);
    assert.ok(out.greeting.length > 0);
    assert.equal(out.whisper.toLowerCase().includes('cibubur'), false);
    assert.equal(out.greeting.toLowerCase().includes('cibubur'), false);
    assert.equal(out.isPreview, preset !== 'auto');
  }
  assert.equal(isPaydayWindow(new Date(2026, 10, 25, 10)), true);
  assert.equal(isPaydayWindow(new Date(2026, 10, 1, 10)), true);
  assert.equal(isPaydayWindow(new Date(2026, 10, 15, 10)), false);
});

console.log(`\nall passed (${passed})`);

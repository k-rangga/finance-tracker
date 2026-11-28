/**
 * Fetch cached current home weather for Maxie using Open-Meteo (zero keys, zero GPS prompts).
 * Gracefully responds `{ ok: false }` if the upstream weather service is slow or unreachable.
 */
import { json } from '../server/env.js';

const HOME_LAT = -6.375178;
const HOME_LON = 106.959952;

export async function GET() {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${HOME_LAT}&longitude=${HOME_LON}` +
      '&current=temperature_2m,weather_code,is_day&timezone=Asia%2FJarkarta';
    const r = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (!r.ok) return json({ ok: false });
    const body = (await r.json()) as {
      current?: {
        temperature_2m?: number;
        weather_code?: number;
        is_day?: number;
      };
    };
    const c = body.current;
    if (!c) return json({ ok: false });
    return new Response(
      JSON.stringify({
        ok: true,
        weatherCode: typeof c.weather_code === 'number' ? c.weather_code : null,
        tempC: typeof c.temperature_2m === 'number' ? c.temperature_2m : null,
        isDay: c.is_day === 1 ? true : c.is_day === 0 ? false : null,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=1200, stale-while-revalidate=600',
        },
      },
    );
  } catch {
    return json({ ok: false });
  }
}

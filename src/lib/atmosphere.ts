export const MAXIE_HOME_LAT = -6.375178;
export const MAXIE_HOME_LON = 106.959952;

export type WeatherMood = 'sunny' | 'cloudy' | 'rain' | 'storm' | 'sunset' | 'night';
export type SeasonVibe = 'none' | 'christmas' | 'newyear' | 'summer' | 'independence';
export type AtmospherePreset =
  | 'auto'
  | 'rain'
  | 'sunny'
  | 'cloudy'
  | 'sunset'
  | 'night'
  | 'summer'
  | 'christmas'
  | 'newyear';

export const ATMOSPHERE_PRESETS: AtmospherePreset[] = [
  'auto',
  'rain',
  'sunny',
  'cloudy',
  'sunset',
  'night',
  'summer',
  'christmas',
  'newyear',
];

export type ResolvedAtmosphere = {
  weather: WeatherMood;
  season: SeasonVibe;
  payday: boolean;
  tempC: number | null;
  whisper: string;
  greeting: string;
  isPreview: boolean;
};

/** Map an Open-Meteo WMO weather code + local hour into a visual sky mood. */
export function weatherFromWmo(code: number | null | undefined, hour: number, isDay?: boolean | null): WeatherMood {
  if (code === 95 || code === 96 || code === 99) return 'storm';
  if (
    code != null &&
    ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))
  ) {
    return 'rain';
  }
  if (hour >= 19 || hour < 5 || isDay === false) return 'night';
  if (hour === 17 || hour === 18) return 'sunset';
  if (code != null && (code === 1 || code === 2 || code === 3 || code === 45 || code === 48)) {
    return 'cloudy';
  }
  return 'sunny';
}

/**
 * Seasonal mood:
 * - Christmas: Dec 11 through Dec 25 (-14 days to Christmas)
 * - New Year: Dec 31 through Jan 2
 * - Aug 17: cozy red-and-white bandana day
 * - Summer: Jun–Aug or hot bright sunshine (>= 31°C)
 */
export function detectSeason(date: Date, weather: WeatherMood, tempC?: number | null): SeasonVibe {
  const m = date.getMonth(); // 0-indexed (0 = Jan, 11 = Dec)
  const d = date.getDate();

  if (m === 11 && d >= 11 && d <= 25) return 'christmas';
  if ((m === 11 && d === 31) || (m === 0 && d <= 2)) return 'newyear';
  if (m === 7 && d === 17) return 'independence';
  if ((m >= 5 && m <= 7) || (weather === 'sunny' && typeof tempC === 'number' && tempC >= 31)) {
    return 'summer';
  }
  return 'none';
}

/** Gentle end-of-month / payday window check (25th through 1st). */
export function isPaydayWindow(date: Date): boolean {
  const d = date.getDate();
  return d >= 25 || d <= 1;
}

function buildWhisper(weather: WeatherMood, season: SeasonVibe): string {
  if (season === 'christmas') return 'Snowy holiday spirit at my house';
  if (season === 'newyear') return 'Party lights are up at my house';
  if (season === 'independence') return 'Feeling festive at my house today';
  if (weather === 'storm') return 'Big thunder outside — staying cozy indoors';
  if (weather === 'rain') return "It's raining at my house";
  if (weather === 'sunset') return 'Golden sunset outside my window';
  if (weather === 'night') return 'Quiet starry night at my house';
  if (season === 'summer') return 'Bright summer sun at my place';
  if (weather === 'cloudy') return 'Soft clouds floating over my house';
  return 'Warm sunshine at my place';
}

function buildGreeting(weather: WeatherMood, season: SeasonVibe, payday: boolean, hour: number): string {
  if (season === 'christmas') return 'Happy holidays! Ready to check in?';
  if (season === 'newyear') return 'Happy New Year! Ready to check in?';
  if (weather === 'rain' || weather === 'storm') return 'Rainy outside — cozy time to check in.';
  if (payday) return 'Fresh cycle energy! Ready to check in?';
  if (hour < 12) return 'Good morning! Ready to check in?';
  if (hour < 18) return 'Good afternoon! Ready to check in?';
  return 'Good evening! Ready to check in?';
}

/** Resolve live or previewed atmospheric mood using warm first-person phrasing. */
export function resolveAtmosphere({
  date = new Date(),
  weatherCode = null,
  tempC = null,
  isDay = null,
  preset = 'auto',
}: {
  date?: Date;
  weatherCode?: number | null;
  tempC?: number | null;
  isDay?: boolean | null;
  preset?: AtmospherePreset;
} = {}): ResolvedAtmosphere {
  const hour = date.getHours();
  const payday = isPaydayWindow(date);

  let weather: WeatherMood;
  let season: SeasonVibe;
  const isPreview = preset !== 'auto';

  if (preset === 'christmas') {
    weather = 'night';
    season = 'christmas';
  } else if (preset === 'newyear') {
    weather = 'night';
    season = 'newyear';
  } else if (preset === 'summer') {
    weather = 'sunny';
    season = 'summer';
  } else if (preset === 'rain' || preset === 'sunny' || preset === 'cloudy' || preset === 'sunset' || preset === 'night') {
    weather = preset;
    season = detectSeason(date, weather, tempC);
  } else {
    weather = weatherFromWmo(weatherCode, hour, isDay);
    season = detectSeason(date, weather, tempC);
  }

  return {
    weather,
    season,
    payday,
    tempC: typeof tempC === 'number' ? tempC : null,
    whisper: buildWhisper(weather, season),
    greeting: buildGreeting(weather, season, payday, hour),
    isPreview,
  };
}

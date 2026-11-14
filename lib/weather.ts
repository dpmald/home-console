const CODES: Record<number, [string, string]> = {
  0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Cloudy'],
  45: ['🌫️', 'Fog'], 48: ['🌫️', 'Freezing fog'],
  51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'],
  56: ['🌧️', 'Freezing drizzle'], 57: ['🌧️', 'Freezing drizzle'],
  61: ['🌦️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
  66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'],
  71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow grains'],
  80: ['🌦️', 'Showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Heavy showers'],
  85: ['🌨️', 'Snow showers'], 86: ['❄️', 'Heavy snow showers'],
  95: ['⛈️', 'Thunderstorms'], 96: ['⛈️', 'Thunderstorms & hail'], 99: ['⛈️', 'Thunderstorms & hail'],
};
const describe = (code: number) => {
  const [emoji, label] = CODES[code] ?? ['🌡️', 'Weather'];
  return { emoji, label };
};

export interface Weather {
  current: { temp: number; feels: number; emoji: string; label: string };
  today: { hi: number; lo: number; precip: number | null; emoji: string; label: string };
  tomorrow: { hi: number; lo: number; precip: number | null; emoji: string; label: string };
}

/** Open-Meteo — free, no API key. */
export async function getWeather(): Promise<Weather> {
  const lat = process.env.WEATHER_LAT;
  const lon = process.env.WEATHER_LON;
  if (!lat || !lon) throw new Error('WEATHER_LAT / WEATHER_LON not set');
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,apparent_temperature,weather_code' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&temperature_unit=fahrenheit&timezone=auto&forecast_days=2';
  const r = await fetch(url, { next: { revalidate: 600 } });
  if (!r.ok) throw new Error(`weather HTTP ${r.status}`);
  const j = await r.json();
  const day = (i: number) => ({
    hi: Math.round(j.daily.temperature_2m_max[i]),
    lo: Math.round(j.daily.temperature_2m_min[i]),
    precip: j.daily.precipitation_probability_max?.[i] ?? null,
    ...describe(j.daily.weather_code[i]),
  });
  return {
    current: {
      temp: Math.round(j.current.temperature_2m),
      feels: Math.round(j.current.apparent_temperature),
      ...describe(j.current.weather_code),
    },
    today: day(0),
    tomorrow: day(1),
  };
}

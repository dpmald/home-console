const CODES: Record<number, [string, string, string]> = {
  0: ['☀️', 'Clear', 'sunny'],
  1: ['🌤️', 'Mostly clear', 'sunny'],
  2: ['⛅', 'Partly cloudy', 'partly_cloudy_day'],
  3: ['☁️', 'Cloudy', 'cloud'],
  45: ['🌫️', 'Fog', 'foggy'],
  48: ['🌫️', 'Freezing fog', 'foggy'],
  51: ['🌦️', 'Light drizzle', 'rainy'],
  53: ['🌦️', 'Drizzle', 'rainy'],
  55: ['🌧️', 'Heavy drizzle', 'rainy'],
  56: ['🌧️', 'Freezing drizzle', 'rainy'],
  57: ['🌧️', 'Freezing drizzle', 'rainy'],
  61: ['🌦️', 'Light rain', 'rainy'],
  63: ['🌧️', 'Rain', 'rainy'],
  65: ['🌧️', 'Heavy rain', 'rainy'],
  66: ['🌧️', 'Freezing rain', 'rainy'],
  67: ['🌧️', 'Freezing rain', 'rainy'],
  71: ['🌨️', 'Light snow', 'weather_snowy'],
  73: ['🌨️', 'Snow', 'weather_snowy'],
  75: ['❄️', 'Heavy snow', 'weather_snowy'],
  77: ['🌨️', 'Snow grains', 'weather_snowy'],
  80: ['🌦️', 'Showers', 'rainy'],
  81: ['🌧️', 'Showers', 'rainy'],
  82: ['⛈️', 'Heavy showers', 'rainy'],
  85: ['🌨️', 'Snow showers', 'weather_snowy'],
  86: ['❄️', 'Heavy snow showers', 'weather_snowy'],
  95: ['⛈️', 'Thunderstorms', 'thunderstorm'],
  96: ['⛈️', 'Thunderstorms & hail', 'thunderstorm'],
  99: ['⛈️', 'Thunderstorms & hail', 'thunderstorm'],
};

export const describeWeatherCode = (code: number) => {
  const [emoji, label, icon] = CODES[code] ?? ['🌡️', 'Weather', 'partly_cloudy_day'];
  return { emoji, label, icon };
};

export interface Weather {
  current: { temp: number; feels: number; emoji: string; label: string; icon?: string };
  today: { hi: number; lo: number; precip: number | null; emoji: string; label: string; icon?: string };
  tomorrow: { hi: number; lo: number; precip: number | null; emoji: string; label: string; icon?: string };
}

export const NYC_LAT = '40.7128';
export const NYC_LON = '-74.0060';

export function parseOpenMeteoResponse(j: any): Weather {
  const day = (i: number) => ({
    hi: Math.round(j.daily.temperature_2m_max[i]),
    lo: Math.round(j.daily.temperature_2m_min[i]),
    precip: j.daily.precipitation_probability_max?.[i] ?? null,
    ...describeWeatherCode(j.daily.weather_code[i]),
  });
  return {
    current: {
      temp: Math.round(j.current.temperature_2m),
      feels: Math.round(j.current.apparent_temperature),
      ...describeWeatherCode(j.current.weather_code),
    },
    today: day(0),
    tomorrow: day(1),
  };
}

/** Open-Meteo — free, no API key. Defaults to NYC (40.7128, -74.0060). */
export async function getWeather(): Promise<Weather> {
  const lat = process.env.WEATHER_LAT || NYC_LAT;
  const lon = process.env.WEATHER_LON || NYC_LON;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,apparent_temperature,weather_code' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&temperature_unit=fahrenheit&timezone=auto&forecast_days=2';
  const r = await fetch(url, { next: { revalidate: 600 } });
  if (!r.ok) throw new Error(`weather HTTP ${r.status}`);
  const j = await r.json();
  return parseOpenMeteoResponse(j);
}

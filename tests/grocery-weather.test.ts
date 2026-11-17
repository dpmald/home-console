import test from 'node:test';
import assert from 'node:assert/strict';
import { getWeather, NYC_LAT, NYC_LON } from '../lib/weather';

test('synthetic preview blocks weather before any network request, including configured coordinates', async () => {
  const previous = { mode: process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT, lat: process.env.WEATHER_LAT, lon: process.env.WEATHER_LON };
  const fetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('Unexpected network request'); };
  try {
    process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT = '1';
    for (const coordinates of [['', ''], ['40', '-74']]) {
      [process.env.WEATHER_LAT, process.env.WEATHER_LON] = coordinates;
      await assert.rejects(getWeather(), /disabled in the synthetic grocery preview/);
    }
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = fetch;
    for (const [key, value] of Object.entries({ HOME_CONSOLE_GROCERY_DEVELOPMENT: previous.mode, WEATHER_LAT: previous.lat, WEATHER_LON: previous.lon })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('normal weather retains main NYC default and mapped weather icons', async () => {
  const previous = { mode: process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT, lat: process.env.WEATHER_LAT, lon: process.env.WEATHER_LON };
  const fetch = globalThis.fetch;
  let request = '';
  globalThis.fetch = async input => {
    request = String(input);
    return Response.json({ current: { temperature_2m: 50, apparent_temperature: 48, weather_code: 61 }, daily: {
      temperature_2m_max: [55, 53], temperature_2m_min: [40, 39], precipitation_probability_max: [70, 20], weather_code: [61, 2],
    } });
  };
  try {
    delete process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT;
    delete process.env.WEATHER_LAT;
    delete process.env.WEATHER_LON;
    const weather = await getWeather();
    const url = new URL(request);
    assert.equal(url.searchParams.get('latitude'), NYC_LAT);
    assert.equal(url.searchParams.get('longitude'), NYC_LON);
    assert.equal(weather.current.icon, 'rainy');
    assert.equal(weather.tomorrow.icon, 'partly_cloudy_day');
  } finally {
    globalThis.fetch = fetch;
    for (const [key, value] of Object.entries({ HOME_CONSOLE_GROCERY_DEVELOPMENT: previous.mode, WEATHER_LAT: previous.lat, WEATHER_LON: previous.lon })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

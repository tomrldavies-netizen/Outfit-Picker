// Weather from Open-Meteo (free, no key) and working out what it means
// for your outfit: do you need a layer, a coat, something waterproof?
import { RULES } from './settings.js';

const CACHE_KEY = 'outfit-weather';
const CACHE_MINUTES = 60;

export function getGpsPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser has no location access.'));
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => reject(new Error(err.message || 'Location unavailable')),
      { timeout: 10000, maximumAge: 30 * 60 * 1000, enableHighAccuracy: false },
    );
  });
}

export async function searchTown(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Town search failed.');
  const data = await res.json();
  return (data.results || []).map(r => ({
    name: [r.name, r.admin1, r.country_code].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

export function clearWeatherCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

// GPS first (if allowed), then your saved town.
export async function resolveLocation(prefs) {
  if (prefs.useGps) {
    try {
      const pos = await getGpsPosition();
      return { ...pos, name: 'Your location' };
    } catch (e) {
      if (!prefs.town) throw new Error(`Couldn't get your location (${e.message}). Set a town in Settings.`);
    }
  }
  if (prefs.town) return prefs.town;
  throw new Error('Set your town in Settings so I can check the weather.');
}

export async function fetchForecast(loc) {
  const key = `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)},${new Date().toDateString()}`;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { /* ignore */ }
  if (cached?.key === key && Date.now() - cached.at < CACHE_MINUTES * 60000) return cached.data;

  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${loc.lat}&longitude=${loc.lon}`
    + '&hourly=apparent_temperature,precipitation_probability,precipitation'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min'
    + '&timezone=auto&forecast_days=1';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`weather service replied ${res.status}`);
    const data = await res.json();
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ key, at: Date.now(), data })); } catch { /* ignore */ }
    return data;
  } catch (e) {
    if (cached?.key === key) return cached.data; // offline: use this morning's forecast
    throw new Error(`Couldn't load the weather (${e.message}).`);
  }
}

const CODES = [
  [0, '☀️', 'Clear'], [2, '🌤️', 'Partly cloudy'], [3, '☁️', 'Cloudy'], [48, '🌫️', 'Fog'],
  [57, '🌦️', 'Drizzle'], [67, '🌧️', 'Rain'], [77, '🌨️', 'Snow'], [82, '🌧️', 'Showers'],
  [86, '🌨️', 'Snow showers'], [99, '⛈️', 'Thunderstorms'],
];

// Turn the raw forecast into the decisions the outfit rules need.
export function summarise(data, locationName) {
  const W = RULES.weather;
  const h = data.hourly;
  const hours = h.time
    .map((t, i) => ({ hour: Number(t.slice(11, 13)), i }))
    .filter(x => x.hour >= W.dayStartHour && x.hour <= W.dayEndHour)
    .map(x => x.i);

  const feelsList = hours.map(i => h.apparent_temperature[i]).filter(v => v != null);
  const avg = feelsList.reduce((a, b) => a + b, 0) / feelsList.length;
  const coldest = Math.min(...feelsList);
  const feels = Math.round(W.useColdestHour ? coldest : avg);
  const rainChance = Math.max(0, ...hours.map(i => h.precipitation_probability?.[i] ?? 0));
  const rainMm = Math.round(hours.reduce((sum, i) => sum + (h.precipitation?.[i] ?? 0), 0) * 10) / 10;
  const raining = rainChance >= W.rainChancePercent || rainMm >= W.rainTotalMm;

  const needsLayer = feels < W.layerBelowC && (feels >= W.coatBelowC || feels < W.layerAndCoatBelowC);
  const needsCoat = feels < W.coatBelowC || raining;
  const targetWarmth = W.warmthBands.find(b => feels >= b.minC)?.warmth ?? 3;

  const code = data.daily?.weather_code?.[0] ?? 0;
  const [, icon, desc] = CODES.find(([max]) => code <= max) || CODES[0];

  const basis = W.useColdestHour ? 'coldest hour' : 'daytime average';
  const reasons = [
    `Feels like ${feels}° (${basis}, ${W.dayStartHour}:00–${W.dayEndHour}:00) → warmth target ${targetWarmth}/5`,
    `Rain: ${rainChance}% chance, ${rainMm} mm → ${raining ? 'rainy' : 'dry'}`,
    needsLayer ? `Layer needed (below ${feels < W.layerAndCoatBelowC ? W.layerAndCoatBelowC : W.layerBelowC}°)` : 'No layer needed',
    needsCoat ? `Coat needed (${raining ? 'rain' : `below ${W.coatBelowC}°`})` : 'No coat needed',
  ];

  return {
    locationName, feels, coldest: Math.round(coldest), rainChance, rainMm, raining,
    needsLayer, needsCoat, targetWarmth, icon, desc,
    high: Math.round(data.daily?.temperature_2m_max?.[0] ?? feels),
    low: Math.round(data.daily?.temperature_2m_min?.[0] ?? feels),
    reasons, unknown: false,
  };
}

// Used when the weather can't be loaded: a mild dry day, clearly flagged.
export function unknownWeather() {
  return {
    locationName: '', feels: 15, rainChance: 0, rainMm: 0, raining: false,
    needsLayer: false, needsCoat: false, targetWarmth: 3, icon: '❔', desc: 'Weather unavailable',
    reasons: ['Weather unavailable: assuming a mild, dry day'], unknown: true,
  };
}

import { Action, ActionPanel, Color, Icon, List, LocalStorage } from "@raycast/api";
import { useEffect, useState } from "react";

/**
 * Cedarville's forecast, with the same clothing advice as the phone version
 * (cedarstalk-mobile) -- deliberately the same rules, so "wear a coat"
 * means the same thing whichever screen answered it.
 *
 * Calls Open-Meteo directly rather than through cedarstalk: it needs no API
 * key, no account, and no dependency on the engine being up at all. Weather
 * is the one command in this extension that works even if nothing else does.
 */

const LAT = 39.744;
const LON = -83.809;

const COLD_KEY = "runsCold";
// Same default as the phone version: a stated preference, not a guess.
const COLD_OFFSET_F = 8;

const WMO: Record<number, { icon: string; label: string; rain?: boolean; snow?: boolean; storm?: boolean }> = {
  0: { icon: "☀️", label: "Clear" },
  1: { icon: "🌤️", label: "Mostly clear" },
  2: { icon: "⛅", label: "Partly cloudy" },
  3: { icon: "☁️", label: "Overcast" },
  45: { icon: "🌫️", label: "Fog" },
  48: { icon: "🌫️", label: "Fog" },
  51: { icon: "🌦️", label: "Light drizzle", rain: true },
  53: { icon: "🌦️", label: "Drizzle", rain: true },
  55: { icon: "🌧️", label: "Dense drizzle", rain: true },
  56: { icon: "🌧️", label: "Freezing drizzle", rain: true },
  57: { icon: "🌧️", label: "Freezing drizzle", rain: true },
  61: { icon: "🌦️", label: "Light rain", rain: true },
  63: { icon: "🌧️", label: "Rain", rain: true },
  65: { icon: "🌧️", label: "Heavy rain", rain: true },
  66: { icon: "🌧️", label: "Freezing rain", rain: true },
  67: { icon: "🌧️", label: "Freezing rain", rain: true },
  71: { icon: "🌨️", label: "Light snow", snow: true },
  73: { icon: "🌨️", label: "Snow", snow: true },
  75: { icon: "❄️", label: "Heavy snow", snow: true },
  77: { icon: "❄️", label: "Snow grains", snow: true },
  80: { icon: "🌦️", label: "Rain showers", rain: true },
  81: { icon: "🌧️", label: "Rain showers", rain: true },
  82: { icon: "⛈️", label: "Violent showers", rain: true },
  85: { icon: "🌨️", label: "Snow showers", snow: true },
  86: { icon: "❄️", label: "Snow showers", snow: true },
  95: { icon: "⛈️", label: "Thunderstorm", rain: true, storm: true },
  96: { icon: "⛈️", label: "Thunderstorm, hail", rain: true, storm: true },
  99: { icon: "⛈️", label: "Thunderstorm, hail", rain: true, storm: true },
};
const codeInfo = (code: number) => WMO[code] ?? { icon: "🌡️", label: "—" };

interface HourPoint {
  time: string;
  tempF: number;
  feelsLikeF: number;
  precipChance: number;
  code: number;
}
interface WeatherData {
  current: { time: string; tempF: number; feelsLikeF: number; windMph: number; code: number };
  today: { highF: number; lowF: number; precipChance: number; code: number };
  tomorrow: { highF: number; lowF: number; precipChance: number; code: number } | null;
  hourly: HourPoint[];
}

async function fetchWeather(): Promise<WeatherData> {
  const params = new URLSearchParams({
    latitude: String(LAT),
    longitude: String(LON),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
    hourly: "temperature_2m,apparent_temperature,precipitation_probability,weather_code",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "America/New_York",
    forecast_days: "2",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`weather service returned ${res.status}`);
  const raw = (await res.json()) as {
    current: { time: string; temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number };
    hourly: { time: string[]; temperature_2m: number[]; apparent_temperature: number[]; precipitation_probability: number[]; weather_code: number[] };
    daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; weather_code: number[] };
  };

  const startIndex = Math.max(0, raw.hourly.time.indexOf(raw.current.time));
  const hourly = raw.hourly.time.slice(startIndex, startIndex + 12).map((time, i) => ({
    time,
    tempF: raw.hourly.temperature_2m[startIndex + i],
    feelsLikeF: raw.hourly.apparent_temperature[startIndex + i],
    precipChance: raw.hourly.precipitation_probability[startIndex + i],
    code: raw.hourly.weather_code[startIndex + i],
  }));

  return {
    current: {
      time: raw.current.time,
      tempF: raw.current.temperature_2m,
      feelsLikeF: raw.current.apparent_temperature,
      windMph: raw.current.wind_speed_10m,
      code: raw.current.weather_code,
    },
    today: {
      highF: raw.daily.temperature_2m_max[0],
      lowF: raw.daily.temperature_2m_min[0],
      precipChance: raw.daily.precipitation_probability_max[0],
      code: raw.daily.weather_code[0],
    },
    tomorrow: raw.daily.time[1]
      ? {
          highF: raw.daily.temperature_2m_max[1],
          lowF: raw.daily.temperature_2m_min[1],
          precipChance: raw.daily.precipitation_probability_max[1],
          code: raw.daily.weather_code[1],
        }
      : null,
    hourly,
  };
}

function adviceFor(
  { feelsLikeF, precipChance, code, windMph }: { feelsLikeF: number; precipChance: number; code: number; windMph: number },
  cold: boolean,
) {
  const effective = feelsLikeF - (cold ? COLD_OFFSET_F : 0);
  const info = codeInfo(code);

  let headline: string;
  let bottoms: string;
  if (effective >= 78) {
    headline = "Shorts and a t-shirt are plenty";
    bottoms = "shorts are fine";
  } else if (effective >= 65) {
    headline = "T-shirt weather — a light layer for later helps";
    bottoms = "shorts or light pants either way";
  } else if (effective >= 52) {
    headline = "Long sleeves or a light jacket";
    bottoms = "pants";
  } else if (effective >= 38) {
    headline = "A real jacket — a hoodie alone won't cut it";
    bottoms = "pants";
  } else {
    headline = "Heavy coat, and gloves if you're out long";
    bottoms = "pants, and a warm layer under them";
  }

  const lines: string[] = [];
  if (info.storm) {
    lines.push("Thunderstorm risk — a hooded rain coat beats an umbrella if there's lightning.");
  } else if (precipChance >= 60 || (info.rain && precipChance >= 40)) {
    lines.push(`Bring a rain coat — ${precipChance}% chance of rain.`);
  } else if (precipChance >= 30) {
    lines.push(`Worth packing an umbrella — ${precipChance}% chance of rain.`);
  }
  if (info.snow) lines.push("Snow — watch your footing and give yourself extra time.");
  if (windMph >= 20) lines.push(`Windy (${Math.round(windMph)} mph) — a windbreaker layer helps.`);

  return { headline, bottoms, lines, effective };
}

function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric" });
}

export default function Command() {
  const [data, setData] = useState<WeatherData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cold, setCold] = useState(true); // same default as the phone version, for the same reason

  useEffect(() => {
    LocalStorage.getItem<string>(COLD_KEY).then((stored) => {
      if (stored !== undefined) setCold(stored === "1");
    });
    fetchWeather()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setIsLoading(false));
  }, []);

  function toggleCold() {
    setCold((v) => {
      const next = !v;
      LocalStorage.setItem(COLD_KEY, next ? "1" : "0").catch(() => {});
      return next;
    });
  }

  if (error) {
    return (
      <List isLoading={false}>
        <List.EmptyView icon={Icon.CloudSnow} title="Couldn't reach the weather service" description={error} />
      </List>
    );
  }
  if (!data) return <List isLoading={isLoading} />;

  const advice = adviceFor(
    { feelsLikeF: data.current.feelsLikeF, precipChance: data.today.precipChance, code: data.current.code, windMph: data.current.windMph },
    cold,
  );
  const curInfo = codeInfo(data.current.code);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Weather">
      <List.Section title="What to wear">
        <List.Item
          icon={{ source: Icon.Umbrella, tintColor: Color.Blue }}
          title={advice.headline}
          subtitle={`Bottoms: ${advice.bottoms}`}
          accessories={[
            {
              text: `feels ${Math.round(data.current.feelsLikeF)}°${cold ? ` (${Math.round(advice.effective)}° adjusted)` : ""}`,
            },
          ]}
          actions={
            <ActionPanel>
              <Action
                title={cold ? "Stop Adjusting for Running Cold" : "Adjust for Running Cold"}
                icon={Icon.Temperature}
                onAction={toggleCold}
              />
            </ActionPanel>
          }
        />
        {advice.lines.map((line) => (
          <List.Item key={line} icon={{ source: Icon.ExclamationMark, tintColor: Color.Orange }} title={line} />
        ))}
      </List.Section>

      <List.Section title="Right now">
        <List.Item
          icon={{ source: Icon.Sun, tintColor: Color.Yellow }}
          title={`${curInfo.icon}  ${Math.round(data.current.tempF)}°F — ${curInfo.label}`}
          subtitle={`High ${Math.round(data.today.highF)}° · Low ${Math.round(data.today.lowF)}° · ${data.today.precipChance}% chance of rain today`}
        />
        {data.tomorrow ? (
          <List.Item
            icon={{ source: Icon.Calendar, tintColor: Color.SecondaryText }}
            title={`${codeInfo(data.tomorrow.code).icon}  Tomorrow`}
            subtitle={`High ${Math.round(data.tomorrow.highF)}° · Low ${Math.round(data.tomorrow.lowF)}° · ${data.tomorrow.precipChance}% chance of rain`}
          />
        ) : null}
      </List.Section>

      <List.Section title="Next 12 hours">
        {data.hourly.map((hour) => {
          const info = codeInfo(hour.code);
          return (
            <List.Item
              key={hour.time}
              icon={info.icon}
              title={clockOf(hour.time)}
              subtitle={info.label}
              accessories={[
                { text: `${Math.round(hour.tempF)}°` },
                { tag: { value: `${hour.precipChance}%`, color: Color.Blue } },
              ]}
            />
          );
        })}
      </List.Section>
    </List>
  );
}

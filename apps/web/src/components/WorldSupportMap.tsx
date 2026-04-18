import { useState } from "react";
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps";
import isoCountries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import type { CountrySupport } from "../types";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const MAP_COUNTRY_ALIASES: Record<string, string> = {
  "united states of america": "US",
  "united states": "US",
  russia: "RU",
  vietnam: "VN",
  laos: "LA",
  bolivia: "BO",
  moldova: "MD",
  syria: "SY",
  iran: "IR",
  tanzania: "TZ",
  venezuela: "VE",
  congo: "CG",
  "democratic republic of the congo": "CD",
  "republic of the congo": "CG",
  "cote d'ivoire": "CI",
  "cote divoire": "CI",
  "czech republic": "CZ",
  "bosnia and herzegovina": "BA"
};

isoCountries.registerLocale(enLocale);

interface WorldSupportMapProps {
  countries: CountrySupport[];
  activityRatioByIso?: Record<string, number>;
  selectedCountryCode?: string | null;
  onCountrySelect?: (countryCode: string) => void;
}

function normalizeCountryName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ");
}

function resolveGeoIso2(
  properties: Record<string, unknown>,
  countriesByIso: Map<string, CountrySupport>
): string {
  const directCodeCandidates = [
    properties.ISO_A2,
    properties.iso_a2,
    properties.ISO2,
    properties.iso2
  ];
  for (const candidate of directCodeCandidates) {
    if (typeof candidate === "string") {
      const upper = candidate.trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(upper)) {
        return upper;
      }
    }
  }

  const nameCandidates = [properties.NAME, properties.name, properties.ADMIN, properties.admin];
  for (const candidate of nameCandidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = normalizeCountryName(candidate);
    const alias = MAP_COUNTRY_ALIASES[normalized];
    if (alias) {
      return alias;
    }
    const isoCode = isoCountries.getAlpha2Code(candidate, "en");
    if (isoCode && /^[A-Z]{2}$/i.test(isoCode)) {
      return isoCode.toUpperCase();
    }
  }

  for (const candidate of nameCandidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = normalizeCountryName(candidate);
    for (const [iso2, country] of countriesByIso) {
      if (normalizeCountryName(country.country) === normalized) {
        return iso2;
      }
    }
  }

  return "";
}

export function WorldSupportMap({
  countries,
  activityRatioByIso = {},
  selectedCountryCode = null,
  onCountrySelect,
}: WorldSupportMapProps) {
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4;
  const ZOOM_STEP = 0.35;
  if (countries.length === 0) {
    return null;
  }

  const [zoom, setZoom] = useState<number>(1);
  const [center, setCenter] = useState<[number, number]>([0, 18]);
  const countriesByIso = new Map(countries.map((country) => [country.iso2, country]));

  return (
    <div className="map-wrapper world-map__embedded">
      <div className="world-map__zoom-controls" role="group" aria-label="Map zoom controls">
        <button
          type="button"
          className="world-map__zoom-button"
          onClick={() => setZoom((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP))}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="world-map__zoom-button"
          onClick={() => setZoom((current) => Math.max(MIN_ZOOM, current - ZOOM_STEP))}
          aria-label="Zoom out"
        >
          -
        </button>
        <button
          type="button"
          className="world-map__zoom-button world-map__zoom-button--reset"
          onClick={() => {
            setZoom(1);
            setCenter([0, 18]);
          }}
        >
          Reset
        </button>
      </div>
      <ComposableMap projectionConfig={{ scale: 140 }}>
        <ZoomableGroup
          center={center}
          zoom={zoom}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          onMoveEnd={(position: { coordinates: [number, number]; zoom: number }) => {
            setCenter(position.coordinates);
            setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, position.zoom)));
          }}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const properties = geo.properties as Record<string, unknown>;
                const iso2 = resolveGeoIso2(properties, countriesByIso);
                const record = iso2 ? countriesByIso.get(iso2) : undefined;
                const canSelect = Boolean(onCountrySelect && /^[A-Z]{2}$/.test(iso2));
                const isSelected = selectedCountryCode === iso2;
                const activityRatio = Math.max(0, Math.min(1, activityRatioByIso[iso2] ?? 0));
                const hasActivity = activityRatio > 0;
                const fill = isSelected
                  ? "#1d9bf0"
                  : hasActivity
                    ? `color-mix(in srgb, #1d9bf0 ${Math.round(18 + activityRatio * 58)}%, #d2d9e3)`
                    : "#d2d9e3";
                const countryName =
                  typeof properties.NAME === "string"
                    ? properties.NAME
                    : typeof properties.name === "string"
                      ? properties.name
                      : record?.country ?? "Country";

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke={isSelected ? "#ffffff" : "#8ca0b3"}
                    strokeWidth={isSelected ? 1.3 : 0.5}
                    onClick={canSelect ? () => onCountrySelect?.(iso2) : undefined}
                    style={{
                      default: { outline: "none", cursor: canSelect ? "pointer" : "default" },
                      hover: { outline: "none", fill: canSelect ? "#f97316" : fill },
                      pressed: { outline: "none" }
                    }}
                  >
                    <title>
                      {canSelect
                        ? hasActivity
                          ? `${countryName} (activity ${(activityRatio * 100).toFixed(1)}%, click to filter)`
                          : `${countryName} (no activity yet, click to filter)`
                        : countryName}
                    </title>
                  </Geography>
                );
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>
    </div>
  );
}

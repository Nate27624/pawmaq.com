import { scaleLinear } from "d3-scale";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import type { CountrySupport } from "../types";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

interface WorldSupportMapProps {
  countries: CountrySupport[];
}

function supportRatio(country: CountrySupport): number {
  return country.supporters / country.population;
}

export function WorldSupportMap({ countries }: WorldSupportMapProps) {
  if (countries.length === 0) {
    return null;
  }

  const ratios = countries.map((country) => supportRatio(country));
  const minRatio = Math.min(...ratios);
  const maxRatio = Math.max(...ratios);
  const colorScale = scaleLinear<string>().domain([minRatio, maxRatio]).range(["#fee8c8", "#e34a33"]);
  const countriesByIso = new Map(countries.map((country) => [country.iso2, country]));

  const topCountry = countries.reduce((best, current) => {
    const bestRatio = supportRatio(best);
    const currentRatio = supportRatio(current);
    return currentRatio > bestRatio ? current : best;
  }, countries[0]!);

  return (
    <section className="panel world-map reveal">
      <header className="world-map__header">
        <h2>World Support</h2>
        <p>
          Top proportional support: <strong>{topCountry.country}</strong> (
          {(supportRatio(topCountry) * 100).toFixed(2)}% of population)
        </p>
      </header>
      <div className="map-wrapper">
        <ComposableMap projectionConfig={{ scale: 140 }}>
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const properties = geo.properties as { ISO_A2?: string; NAME?: string };
                const iso2 = properties.ISO_A2 ?? "";
                const record = countriesByIso.get(iso2);
                const fill = record ? colorScale(supportRatio(record)) : "#d2d9e3";
                const isTopCountry = record?.iso2 === topCountry.iso2;

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke={isTopCountry ? "#0f172a" : "#8ca0b3"}
                    strokeWidth={isTopCountry ? 1.2 : 0.45}
                    style={{
                      default: { outline: "none" },
                      hover: { outline: "none", fill: "#f97316" },
                      pressed: { outline: "none" }
                    }}
                  >
                    <title>
                      {record
                        ? `${record.country}: ${(supportRatio(record) * 100).toFixed(2)}% support`
                        : properties.NAME ?? "Country"}
                    </title>
                  </Geography>
                );
              })
            }
          </Geographies>
        </ComposableMap>
      </div>
      <ul className="country-list">
        {countries
          .map((country) => ({
            ...country,
            ratio: supportRatio(country)
          }))
          .sort((a, b) => b.ratio - a.ratio)
          .slice(0, 6)
          .map((country) => (
            <li key={country.iso2}>
              <span>{country.country}</span>
              <strong>{(country.ratio * 100).toFixed(2)}%</strong>
            </li>
          ))}
      </ul>
    </section>
  );
}

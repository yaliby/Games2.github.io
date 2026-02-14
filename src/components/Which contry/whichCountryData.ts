import { geoArea, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import type { GeometryCollection, Properties, Topology } from "topojson-specification";

const WORLD_ATLAS_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const WORLD_COUNTRIES_URL =
  "https://cdn.jsdelivr.net/npm/world-countries@5.1.0/countries.json";

export type PlayableCountry = {
  id: string;
  name: string;
  iso2: string;
  iso3: string;
  area: number;
  feature: Feature<Geometry, GeoJsonProperties>;
};

type WorldCountryMeta = {
  ccn3?: string;
  cca2?: string;
  cca3?: string;
  name?: {
    common?: string;
  };
};

type WorldTopology = Topology<{
  countries: GeometryCollection<Properties>;
}>;

function normalizeThreeDigitId(value: string | number | undefined | null): string {
  if (value === undefined || value === null) {
    return "";
  }

  const text = String(value).trim();
  if (!text) {
    return "";
  }

  return text.padStart(3, "0");
}

function isCountryFeatureCollection(
  value: unknown,
): value is FeatureCollection<Geometry, GeoJsonProperties> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const maybeCollection = value as { type?: unknown; features?: unknown };
  return maybeCollection.type === "FeatureCollection" && Array.isArray(maybeCollection.features);
}

async function fetchJsonOrThrow(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url} (${response.status})`);
  }
  return response.json();
}

export async function loadPlayableCountries(): Promise<PlayableCountry[]> {
  const [topologyUnknown, worldCountriesUnknown] = await Promise.all([
    fetchJsonOrThrow(WORLD_ATLAS_URL),
    fetchJsonOrThrow(WORLD_COUNTRIES_URL),
  ]);

  const topology = topologyUnknown as WorldTopology;

  if (!topology.objects?.countries) {
    throw new Error("World topology data is missing countries object");
  }

  const countriesFeaturesUnknown = feature(topology, topology.objects.countries);
  if (!isCountryFeatureCollection(countriesFeaturesUnknown)) {
    throw new Error("Could not convert world topology into feature collection");
  }

  const worldCountries = Array.isArray(worldCountriesUnknown)
    ? (worldCountriesUnknown as WorldCountryMeta[])
    : [];

  const metadataByCcn3 = new Map<string, WorldCountryMeta>();
  for (const country of worldCountries) {
    const id = normalizeThreeDigitId(country.ccn3);
    if (!id) {
      continue;
    }
    metadataByCcn3.set(id, country);
  }

  const playableMap = new Map<string, PlayableCountry>();

  for (const geoFeature of countriesFeaturesUnknown.features) {
    const id = normalizeThreeDigitId(geoFeature.id as string | number | undefined);
    if (!id) {
      continue;
    }

    const meta = metadataByCcn3.get(id);
    const iso2 = meta?.cca2?.toLowerCase();
    const iso3 = meta?.cca3?.toUpperCase();
    if (!iso2 || !iso3 || !/^[a-z]{2}$/.test(iso2)) {
      continue;
    }

    const name = meta?.name?.common ?? iso3;

    const enrichedFeature: Feature<Geometry, GeoJsonProperties> = {
      ...geoFeature,
      id,
      properties: {
        ...(geoFeature.properties ?? {}),
        name,
        iso2,
        iso3,
      },
    };

    const permissible = enrichedFeature as GeoPermissibleObjects;
    const country: PlayableCountry = {
      id,
      name,
      iso2,
      iso3,
      feature: enrichedFeature,
      area: geoArea(permissible),
    };

    playableMap.set(country.iso3, country);
  }

  return [...playableMap.values()].sort((a, b) => a.name.localeCompare(b.name));
}

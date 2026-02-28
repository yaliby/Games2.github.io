import { geoArea, geoCentroid, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import type { GeometryCollection, Properties, Topology } from "topojson-specification";

const WORLD_ATLAS_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const WORLD_COUNTRIES_URL =
  "https://cdn.jsdelivr.net/npm/world-countries@5.1.0/countries.json";
const BLOCKED_ISO3 = new Set(["PSE"]);
const BLOCKED_ISO2 = new Set(["ps"]);
const BLOCKED_NAMES = new Set([
  "palestine",
  "state of palestine",
  "palestinian territories",
  "palestinian territory, occupied",
]);

export type PlayableCountry = {
  id: string;
  name: string;
  iso2: string;
  iso3: string;
  region: string;
  centroid: [number, number];
  area: number;
  feature: Feature<Geometry, GeoJsonProperties>;
};

type WorldCountryMeta = {
  ccn3?: string;
  cca2?: string;
  cca3?: string;
  region?: string;
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

function normalizeCountryName(value: string | undefined): string {
  return value
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

function isBlockedCountry(
  iso3: string | undefined,
  iso2: string | undefined,
  name: string | undefined,
): boolean {
  const normalizedIso3 = iso3?.trim().toUpperCase() ?? "";
  const normalizedIso2 = iso2?.trim().toLowerCase() ?? "";
  const normalizedName = normalizeCountryName(name);

  return (
    BLOCKED_ISO3.has(normalizedIso3) ||
    BLOCKED_ISO2.has(normalizedIso2) ||
    BLOCKED_NAMES.has(normalizedName)
  );
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
    if (isBlockedCountry(country.cca3, country.cca2, country.name?.common)) {
      continue;
    }

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
    const rawIso2 = meta?.cca2?.toLowerCase();
    const iso3 = meta?.cca3?.toUpperCase();
    const rawName = meta?.name?.common;
    const rawRegion = meta?.region;

    if (isBlockedCountry(iso3, rawIso2, rawName)) {
      continue;
    }

    const iso2 = rawIso2;
    if (!iso2 || !iso3 || !/^[a-z]{2}$/.test(iso2)) {
      continue;
    }
    const name = rawName?.trim() || iso3;
    const region = rawRegion?.trim() || "Unknown";

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
    const centroidRaw = geoCentroid(permissible);
    const centroid: [number, number] = (
      Array.isArray(centroidRaw) &&
      centroidRaw.length === 2 &&
      Number.isFinite(centroidRaw[0]) &&
      Number.isFinite(centroidRaw[1])
    )
      ? [centroidRaw[0], centroidRaw[1]]
      : [0, 0];
    const country: PlayableCountry = {
      id,
      name,
      iso2,
      iso3,
      region,
      centroid,
      feature: enrichedFeature,
      area: geoArea(permissible),
    };

    playableMap.set(country.iso3, country);
  }

  return [...playableMap.values()]
    .filter((country) => !isBlockedCountry(country.iso3, country.iso2, country.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

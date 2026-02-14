import { useMemo, useState } from "react";
import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import type { MouseEvent } from "react";
import type { PlayableCountry } from "./whichCountryData";

const MAP_WIDTH = 960;
const MAP_HEIGHT = 520;

export type MapFeedback =
  | {
      type: "correct" | "wrong";
      clickedIso3: string;
    }
  | null;

type TooltipState = {
  name: string;
  x: number;
  y: number;
};

type Props = {
  countries: PlayableCountry[];
  feedback: MapFeedback;
  revealCorrectIso3: string | null;
  disabled: boolean;
  onCountryClick: (country: PlayableCountry) => void;
};

function getCountryClassName(
  country: PlayableCountry,
  feedback: MapFeedback,
  revealCorrectIso3: string | null,
  disabled: boolean,
): string {
  const classNames = ["which-country-map__country"];

  if (disabled) {
    classNames.push("is-disabled");
  }
  if (feedback?.type === "correct" && feedback.clickedIso3 === country.iso3) {
    classNames.push("is-correct");
  }
  if (feedback?.type === "wrong" && feedback.clickedIso3 === country.iso3) {
    classNames.push("is-wrong");
  }
  if (revealCorrectIso3 === country.iso3) {
    classNames.push("is-reveal");
  }

  return classNames.join(" ");
}

function getPointerPosition(event: MouseEvent<SVGPathElement>): { x: number; y: number } {
  const svg = event.currentTarget.ownerSVGElement;
  const rect = svg?.getBoundingClientRect();
  if (!rect) {
    return { x: 0, y: 0 };
  }
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

export default function WhichCountryMap({
  countries,
  feedback,
  revealCorrectIso3,
  disabled,
  onCountryClick,
}: Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const projected = useMemo(() => {
    const projection = geoNaturalEarth1();
    projection.fitExtent(
      [
        [12, 12],
        [MAP_WIDTH - 12, MAP_HEIGHT - 12],
      ],
      {
        type: "FeatureCollection",
        features: countries.map((country) => country.feature),
      },
    );

    const pathGen = geoPath(projection);
    const ocean = pathGen({ type: "Sphere" }) ?? "";
    const graticule = pathGen(geoGraticule10()) ?? "";
    const paths = countries.map((country) => ({
      country,
      d: pathGen(country.feature) ?? "",
    }));

    return {
      ocean,
      graticule,
      paths,
    };
  }, [countries]);

  return (
    <section className="which-country-map">
      <svg
        className="which-country-map__svg"
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        role="img"
        aria-label="World map. Click a country to answer."
      >
        <path className="which-country-map__ocean" d={projected.ocean} />
        <path className="which-country-map__graticule" d={projected.graticule} />
        {projected.paths.map(({ country, d }) => (
          <path
            key={country.iso3}
            className={getCountryClassName(country, feedback, revealCorrectIso3, disabled)}
            d={d}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-label={`Select ${country.name}`}
            onClick={() => {
              if (!disabled) {
                onCountryClick(country);
              }
            }}
            onKeyDown={(event) => {
              if (disabled) {
                return;
              }
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onCountryClick(country);
              }
            }}
            onMouseEnter={(event) => {
              const { x, y } = getPointerPosition(event);
              setTooltip({
                name: country.name,
                x,
                y,
              });
            }}
            onMouseMove={(event) => {
              const { x, y } = getPointerPosition(event);
              setTooltip((prev) => ({
                name: prev?.name ?? country.name,
                x,
                y,
              }));
            }}
            onMouseLeave={() => {
              setTooltip(null);
            }}
            onBlur={() => {
              setTooltip(null);
            }}
          />
        ))}
      </svg>

      {tooltip && (
        <div
          className="which-country-map__tooltip"
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
          }}
        >
          {tooltip.name}
        </div>
      )}
    </section>
  );
}

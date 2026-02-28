import { useMemo } from "react";
import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import type { PlayableCountry } from "./whichCountryData";

const MAP_WIDTH = 960;
const MAP_HEIGHT = 520;

export type MapFeedback =
  | {
      type: "correct" | "wrong";
      clickedIso3: string;
    }
  | null;

type Props = {
  countries: PlayableCountry[];
  feedback: MapFeedback;
  revealCorrectIso3: string | null;
  completedIso3Set?: ReadonlySet<string>;
  disabled: boolean;
  onCountryClick: (country: PlayableCountry) => void;
};

function getCountryClassName(
  country: PlayableCountry,
  feedback: MapFeedback,
  revealCorrectIso3: string | null,
  completedIso3Set: ReadonlySet<string> | undefined,
  disabled: boolean,
): string {
  const classNames = ["which-country-map__country"];
  const isCompleted = completedIso3Set?.has(country.iso3) ?? false;

  if (disabled) {
    classNames.push("is-disabled");
  }
  if (isCompleted) {
    classNames.push("is-completed");
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

export default function WhichCountryMap({
  countries,
  feedback,
  revealCorrectIso3,
  completedIso3Set,
  disabled,
  onCountryClick,
}: Props) {
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
        {projected.paths.map(({ country, d }) => {
          const isCompleted = completedIso3Set?.has(country.iso3) ?? false;
          const isBlocked = disabled || isCompleted;
          return (
            <path
              key={country.iso3}
              className={getCountryClassName(country, feedback, revealCorrectIso3, completedIso3Set, disabled)}
              d={d}
              role="button"
              tabIndex={isBlocked ? -1 : 0}
              aria-label={`Select ${country.name}`}
              onClick={() => {
                if (!isBlocked) {
                  onCountryClick(country);
                }
              }}
              onKeyDown={(event) => {
                if (isBlocked) {
                  return;
                }
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onCountryClick(country);
                }
              }}
            />
          );
        })}
      </svg>
    </section>
  );
}

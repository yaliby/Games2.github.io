const VIEWPORT_PADDING = 8;
const TOOLTIP_OFFSET = 34;

export function updateMedalTooltipPlacement(medalElement: HTMLElement) {
  const tooltipElement = medalElement.querySelector<HTMLElement>(".userbox__tooltip");
  if (!tooltipElement) return;

  medalElement.dataset.tooltipPlacement = "top";
  medalElement.style.setProperty("--tooltip-shift-x", "0px");

  const medalRect = medalElement.getBoundingClientRect();
  const computedDisplay = window.getComputedStyle(tooltipElement).display;
  const prevInlineDisplay = tooltipElement.style.display;
  const prevInlineVisibility = tooltipElement.style.visibility;

  if (computedDisplay === "none") {
    tooltipElement.style.display = "block";
    tooltipElement.style.visibility = "hidden";
  }

  const tooltipRect = tooltipElement.getBoundingClientRect();

  if (computedDisplay === "none") {
    tooltipElement.style.display = prevInlineDisplay;
    tooltipElement.style.visibility = prevInlineVisibility;
  }

  const requiredSpace = tooltipRect.height + TOOLTIP_OFFSET;
  const topSpace = medalRect.top - VIEWPORT_PADDING;
  const bottomSpace = window.innerHeight - medalRect.bottom - VIEWPORT_PADDING;
  const fitsTop = topSpace >= requiredSpace;
  const fitsBottom = bottomSpace >= requiredSpace;

  let shouldPlaceBottom = false;
  if (!fitsTop && fitsBottom) {
    shouldPlaceBottom = true;
  } else if (!fitsTop && !fitsBottom) {
    // If neither side fully fits, prefer the side with more available space.
    shouldPlaceBottom = bottomSpace > topSpace;
  }

  medalElement.dataset.tooltipPlacement = shouldPlaceBottom ? "bottom" : "top";

  const centerX = medalRect.left + medalRect.width / 2;
  const tooltipHalfWidth = tooltipRect.width / 2;
  const minLeft = centerX - tooltipHalfWidth;
  const maxRight = centerX + tooltipHalfWidth;

  let shiftX = 0;
  if (minLeft < VIEWPORT_PADDING) {
    shiftX = VIEWPORT_PADDING - minLeft;
  } else if (maxRight > window.innerWidth - VIEWPORT_PADDING) {
    shiftX = window.innerWidth - VIEWPORT_PADDING - maxRight;
  }

  medalElement.style.setProperty("--tooltip-shift-x", `${shiftX}px`);
}

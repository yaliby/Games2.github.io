const VIEWPORT_PADDING = 8;
const TOOLTIP_OFFSET = 34;

export function updateMedalTooltipPlacement(medalElement: HTMLElement) {
  const tooltipElement = medalElement.querySelector<HTMLElement>(".userbox__tooltip");
  if (!tooltipElement) return;

  medalElement.dataset.tooltipPlacement = "top";
  medalElement.style.setProperty("--tooltip-shift-x", "0px");

  const medalRect = medalElement.getBoundingClientRect();
  const tooltipRect = tooltipElement.getBoundingClientRect();

  const requiredTopSpace = tooltipRect.height + TOOLTIP_OFFSET;
  const topSpace = medalRect.top;
  const shouldPlaceBottom = topSpace < requiredTopSpace;

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

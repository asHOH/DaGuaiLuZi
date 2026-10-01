import { expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("花色保留面积调整，且轮廓不被裁切", async ({ page }) => {
  const suits = ["H", "D", "S", "C"] as const;
  const vite = await createServer({ server: { middlewareMode: true } });
  try {
    const { SuitIcon } = (await vite.ssrLoadModule(
      "/src/SuitIcon.tsx",
    )) as typeof import("../src/SuitIcon");
    await page.setContent(
      suits
        .map((suit) => renderToStaticMarkup(createElement(SuitIcon, { suit })))
        .join(""),
    );
  } finally {
    await vite.close();
  }
  const measurements = await page.evaluate(async () => {
    const icons = [...document.querySelectorAll("svg")];
    const contained = icons.every((icon) => {
      const bounds = icon.querySelector("path")!.getBBox();
      const box = icon.viewBox.baseVal;
      return (
        bounds.x >= box.x &&
        bounds.y >= box.y &&
        bounds.x + bounds.width <= box.x + box.width &&
        bounds.y + bounds.height <= box.y + box.height
      );
    });
    const ratios = [];
    // Actual card sizes, 2x display density, and a large geometry reference.
    for (const size of [16, 20, 22, 25, 32, 40, 42, 44, 50, 64, 84, 512]) {
      const areas = [];
      for (const icon of icons) {
        const svg = icon.cloneNode(true) as SVGSVGElement;
        svg.setAttribute("width", String(size));
        svg.setAttribute("height", String(size));
        const image = new Image();
        image.src = `data:image/svg+xml,${encodeURIComponent(svg.outerHTML)}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, size, size).data;
        let area = 0;
        for (let i = 3; i < pixels.length; i += 4) area += pixels[i]! / 255;
        areas.push(area);
      }
      ratios.push({
        size,
        areas,
        minimumArea: Math.min(...areas),
        ratio: Math.max(...areas) / Math.min(...areas),
      });
    }
    return {
      contained,
      ratios,
      blackScalesMatch:
        icons[2]!.getAttribute("viewBox") === icons[3]!.getAttribute("viewBox"),
    };
  });
  await test.info().attach("filled-area-measurements", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
  expect(measurements.contained).toBe(true);
  expect(measurements.blackScalesMatch).toBe(true);
  for (const { minimumArea } of measurements.ratios) {
    expect(minimumArea).toBeGreaterThan(0);
  }
  const reference = measurements.ratios.find(({ size }) => size === 512)!;
  expect(reference.areas[1]! / reference.areas[0]!).toBeCloseTo(0.95, 2);
});

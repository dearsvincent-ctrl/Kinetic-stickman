import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

export async function openBrowser(url) {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  const errors = [],
    requests = [],
    responses = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("requestfailed", (r) =>
    errors.push(r.url() + ": " + r.failure()?.errorText),
  );
  page.on("request", (r) => requests.push(r.url()));
  page.on("response", (r) => {
    responses.push(r.url());
    if (r.status() >= 400) errors.push(r.status() + " " + r.url());
  });
  await mkdir("test-results", { recursive: true });
  await page.clock.install();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("#loading", { state: "detached" });
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const cdp = await page.context().newCDPSession(page);
  let previousPoints = new Map();
  const native = async (type, points, changed = points) => {
    if (type === "touchMove")
      changed = changed.filter((p) => {
        const prior = previousPoints.get(p.id);
        return (
          !prior ||
          Math.abs(prior.x - p.x) > 0.01 ||
          Math.abs(prior.y - p.y) > 0.01
        );
      });
    const eventType = {
      touchStart: "pointerdown",
      touchMove: "pointermove",
      touchEnd: "pointerup",
      touchCancel: "pointercancel",
    }[type];
    if (changed.length)
      await page.evaluate(
        ({ eventType, expected }) => {
          window.__nativeAck = new Promise((resolve) => {
            const pending = [...expected];
            const listener = (e) => {
              const index = pending.findIndex(
                (p) =>
                  Math.abs(p.x - e.clientX) < 1 &&
                  Math.abs(p.y - e.clientY) < 1,
              );
              if (index >= 0) pending.splice(index, 1);
              if (!pending.length) {
                window.removeEventListener(eventType, listener, true);
                resolve();
              }
            };
            window.addEventListener(eventType, listener, true);
          });
        },
        { eventType, expected: changed },
      );
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    previousPoints = new Map(points.map((p) => [p.id, p]));
    if (changed.length) {
      let timer;
      try {
        await Promise.race([
          page.evaluate(() => window.__nativeAck),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error("Native input delivery timeout")),
              10000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
  };
  return { browser, page, native, errors, requests, responses };
}

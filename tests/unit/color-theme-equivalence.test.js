/**
 * Unit tests verifying that colorThemes (string) and colorThemesRGBA (array)
 * produce equivalent color values.
 */

const puppeteer = require('puppeteer');

describe('Color Theme Equivalence', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  });

  afterAll(async () => {
    if (browser) await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.goto(`file://${process.cwd()}/index.html?debug=dims:100x100`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 30000 });
  });

  afterEach(async () => {
    if (page) await page.close();
  });

  const themes = ['warm', 'neon', 'iceblue', 'tiedye', 'gray'];

  // Test sample inputs covering various iteration counts and frac values
  const testCases = [
    { i: 1, frac: 0.1, fracD: 0.05, fracL: 0.5, s: 1000 },
    { i: 10, frac: 0.3, fracD: 0.15, fracL: 0.5, s: 1000 },
    { i: 50, frac: 0.5, fracD: 0.25, fracL: 0.5, s: 1000 },
    { i: 100, frac: 0.7, fracD: 0.35, fracL: 0.5, s: 1000 },
    { i: 500, frac: 0.9, fracD: 0.45, fracL: 0.5, s: 1000 },
    { i: 1000, frac: 0.95, fracD: 0.47, fracL: 0.5, s: 1000 },
    { i: 5000, frac: 0.99, fracD: 0.49, fracL: 0.5, s: 1000 },
  ];

  for (const theme of themes) {
    test(`${theme} theme: string and RGBA versions match`, async () => {
      const results = await page.evaluate((themeName, cases) => {
        const config = window.explorer.config;
        const stringFn = config.colorThemes[themeName];
        const rgbaFn = config.colorThemesRGBA[themeName];
        const mismatches = [];

        for (const { i, frac, fracD, fracL, s } of cases) {
          const stringResult = stringFn(i, frac, fracD, fracL, s);
          const rgbaResult = rgbaFn(i, frac, fracD, fracL, s);

          // Parse string result "rgb(r,g,b)" to [r, g, b] - values may be floats
          const match = stringResult.match(/rgb\(([\d.]+),([\d.]+),([\d.]+)\)/);
          if (!match) {
            mismatches.push({
              i, frac,
              error: `Could not parse string result: ${stringResult}`
            });
            continue;
          }
          // Round floats to integers for comparison (browsers do this internally)
          const stringRGB = [
            Math.round(parseFloat(match[1])),
            Math.round(parseFloat(match[2])),
            Math.round(parseFloat(match[3]))
          ];

          // Compare - allow ±1 for rounding differences
          const rDiff = Math.abs(stringRGB[0] - rgbaResult[0]);
          const gDiff = Math.abs(stringRGB[1] - rgbaResult[1]);
          const bDiff = Math.abs(stringRGB[2] - rgbaResult[2]);

          if (rDiff > 1 || gDiff > 1 || bDiff > 1) {
            mismatches.push({
              i, frac,
              stringRGB,
              rgbaRGB: [rgbaResult[0], rgbaResult[1], rgbaResult[2]],
              diff: [rDiff, gDiff, bDiff]
            });
          }
        }

        return { mismatches };
      }, theme, testCases);

      if (results.mismatches.length > 0) {
        console.log(`Mismatches for ${theme}:`, results.mismatches);
      }
      expect(results.mismatches).toHaveLength(0);
    });
  }
});

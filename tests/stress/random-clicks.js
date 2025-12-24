/**
 * Stress test for GPU batch processing with random board sizes and click interactions.
 * Tests for invariant violations during view updates triggered by clicks.
 *
 * Run with: node tests/stress/random-clicks.js
 */

const puppeteer = require("puppeteer");

// Seeded random number generator for reproducibility
class SeededRandom {
  constructor(seed) {
    this.seed = seed;
  }

  next() {
    // Simple LCG
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

async function runFuzzTest(runNumber, seed, totalRuns = 30) {
  const rng = new SeededRandom(seed);

  // Random board size: 700-1000 width, 350-1000 height
  const width = rng.nextInt(700, 1000);
  const height = rng.nextInt(350, 1000);

  // Random number of clicks: 1-3
  const numClicks = rng.nextInt(1, 3);

  // Generate click positions (as fractions of viewport) and delays (0.1-5 seconds)
  const clicks = [];
  for (let i = 0; i < numClicks; i++) {
    clicks.push({
      xFrac: rng.next() * 0.8 + 0.1,  // 10%-90% of width
      yFrac: rng.next() * 0.8 + 0.1,  // 10%-90% of height
      delayMs: Math.floor(rng.next() * 4900) + 100  // 100-5000ms
    });
  }

  const config = { seed, width, height, numClicks, clicks };
  console.log(`\n=== Run ${runNumber}/${totalRuns} ===`);
  console.log(`Config: seed=${seed}, dims=${width}x${height}, clicks=${numClicks}`);
  console.log(`Click positions: ${clicks.map(c => `(${(c.xFrac*100).toFixed(0)}%, ${(c.yFrac*100).toFixed(0)}%) +${(c.delayMs/1000).toFixed(1)}s`).join(', ')}`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height });

    const violations = [];
    const errors = [];

    page.on("console", msg => {
      const text = msg.text();
      if (text.includes("INVARIANT")) {
        violations.push(text);
      }
    });

    page.on("pageerror", err => {
      errors.push(err.message);
    });

    // Navigate with GPU board and timing debug
    await page.goto(`file://${process.cwd()}/index.html?board=gpu&debug=w,t`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 30000 });

    // Wait for initial view to start computing
    await page.waitForFunction(() => {
      const view = window.explorer?.grid?.views?.[0];
      return view && view.it > 0;
    }, { timeout: 30000 });

    // Perform clicks with delays
    for (let i = 0; i < numClicks; i++) {
      const click = clicks[i];
      const x = Math.floor(click.xFrac * width);
      const y = Math.floor(click.yFrac * height);

      // Wait for any update to complete before clicking
      await page.waitForFunction(() => !window.explorer.grid.currentUpdateProcess, { timeout: 10000 });

      console.log(`  Click ${i+1}: (${x}, ${y}), wait ${(click.delayMs/1000).toFixed(1)}s`);
      await page.mouse.click(x, y);

      // Random delay for computation time (0.1-5 seconds)
      await new Promise(r => setTimeout(r, click.delayMs));
    }

    // Let computation run for a bit
    await new Promise(r => setTimeout(r, 3000));

    // Check final state
    const state = await page.evaluate(() => {
      const views = window.explorer.grid.views;
      return {
        viewCount: views.length,
        viewStates: views.map(v => ({
          it: v.it,
          un: v.un,
          di: v.di
        }))
      };
    });

    console.log(`  Final: ${state.viewCount} views, states: ${state.viewStates.map(v => `it=${v.it}`).join(', ')}`);

    if (violations.length > 0) {
      console.log(`  VIOLATIONS: ${violations.length}`);
      violations.forEach(v => console.log(`    ${v}`));
    }

    if (errors.length > 0) {
      console.log(`  ERRORS: ${errors.length}`);
      errors.forEach(e => console.log(`    ${e}`));
    }

    await browser.close();

    return {
      config,
      violations,
      errors,
      success: violations.length === 0 && errors.length === 0
    };

  } catch (err) {
    await browser.close();
    console.log(`  EXCEPTION: ${err.message}`);
    return {
      config,
      violations: [],
      errors: [err.message],
      success: false
    };
  }
}

(async () => {
  console.log("Fuzz testing GPU batch processing with random clicks...\n");

  const results = [];
  const baseSeed = Date.now();

  const totalRuns = parseInt(process.env.STRESS_RUNS) || 30;
  for (let i = 1; i <= totalRuns; i++) {
    const seed = baseSeed + i;
    const result = await runFuzzTest(i, seed, totalRuns);
    results.push(result);

    // Stop early on failure for debugging
    if (!result.success) {
      console.log("\n*** STOPPING EARLY DUE TO FAILURE ***\n");
      break;
    }
  }

  // Summary
  console.log("\n\n========== SUMMARY ==========");
  const failures = results.filter(r => !r.success);
  console.log(`Total runs: ${results.length}`);
  console.log(`Successes: ${results.length - failures.length}`);
  console.log(`Failures: ${failures.length}`);

  if (failures.length > 0) {
    console.log("\nFailed runs (reproducible with these seeds):");
    for (const f of failures) {
      console.log(`\n  Seed: ${f.config.seed}`);
      console.log(`  Dims: ${f.config.width}x${f.config.height}`);
      console.log(`  Clicks: ${f.config.clicks.map(c => `(${(c.xFrac*100).toFixed(0)}%, ${(c.yFrac*100).toFixed(0)}%)`).join(', ')}`);
      if (f.violations.length > 0) {
        console.log(`  Violations:`);
        f.violations.forEach(v => console.log(`    ${v}`));
      }
      if (f.errors.length > 0) {
        console.log(`  Errors:`);
        f.errors.forEach(e => console.log(`    ${e}`));
      }
    }
  }

  process.exit(failures.length > 0 ? 1 : 0);
})();

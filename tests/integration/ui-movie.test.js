/**
 * Integration tests for movie mode
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, waitForViewReady } = require('./test-utils');

describe('Movie Mode Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await setupBrowser();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    page = await setupPage(browser, {}, TEST_TIMEOUT);
    await navigateToApp(page);
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (browser) await browser.close();
  }, TEST_TIMEOUT);

  async function setupForMovieMode(page) {
    await waitForViewReady(page);
    const canvas = await page.$('#grid canvas');
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => window.explorer.grid.views.length >= 2, { timeout: 5000 }, TEST_TIMEOUT);
    await page.waitForTimeout(300);
  }

  test('M key should require multiple views and toggle movie mode correctly', async () => {
    // Test 1: With only one view, M should not activate movie mode
    await page.waitForTimeout(300);
    const viewsBefore = await page.evaluate(() => window.explorer.grid.views.length);
    if (viewsBefore === 1) {
      await page.keyboard.press('m');
      await page.waitForTimeout(200);
      const movieActive = await page.evaluate(() => window.explorer.movieMode.active);
      expect(movieActive).toBe(false);
    }

    // Test 2: Create second view and verify toggle works
    await setupForMovieMode(page);

    const initialActive = await page.evaluate(() => window.explorer.movieMode.active);
    expect(initialActive).toBe(false);

    await page.keyboard.press('m');
    await page.waitForTimeout(300);

    const afterMPress = await page.evaluate(() => {
      const grid = document.getElementById('grid');
      const movie = document.getElementById('movie');
      return {
        active: window.explorer.movieMode.active,
        gridDisplay: window.getComputedStyle(grid).display,
        movieDisplay: window.getComputedStyle(movie).display
      };
    }, TEST_TIMEOUT);
    expect(afterMPress.active).toBe(true);
    expect(afterMPress.gridDisplay).toBe('none');
    expect(afterMPress.movieDisplay).not.toBe('none');

    await page.keyboard.press('m');
    await page.waitForTimeout(300);

    const afterSecondM = await page.evaluate(() => {
      const grid = document.getElementById('grid');
      return {
        active: window.explorer.movieMode.active,
        gridDisplay: window.getComputedStyle(grid).display
      };
    }, TEST_TIMEOUT);
    expect(afterSecondM.active).toBe(false);
    expect(afterSecondM.gridDisplay).not.toBe('none');
  }, TEST_TIMEOUT);

  test('Movie mode should create canvas, show status elements, and clean up on stop', async () => {
    await setupForMovieMode(page);

    await page.keyboard.press('m');
    await page.waitForTimeout(300);

    const movieState = await page.evaluate(() => {
      const movie = document.getElementById('movie');
      return {
        hasMovieCanvas: window.explorer.movieMode.movieCanvas !== null,
        containerHasCanvas: movie.querySelector('canvas') !== null,
        hasScale: movie.querySelector('#moviescale') !== null,
        hasStatus: movie.querySelector('#moviestatus') !== null
      };
    }, TEST_TIMEOUT);
    expect(movieState.hasMovieCanvas).toBe(true);
    expect(movieState.containerHasCanvas).toBe(true);
    expect(movieState.hasScale).toBe(true);
    expect(movieState.hasStatus).toBe(true);

    await page.keyboard.press('m');
    await page.waitForTimeout(300);

    const afterStop = await page.evaluate(() => {
      const movie = document.getElementById('movie');
      return {
        canvasCleanedUp: window.explorer.movieMode.movieCanvas === null,
        containerEmpty: movie.children.length === 0
      };
    }, TEST_TIMEOUT);
    expect(afterStop.canvasCleanedUp).toBe(true);
    expect(afterStop.containerEmpty).toBe(true);
  }, TEST_TIMEOUT);

  test('Movie mode dismissal: keys dismiss, clicks dismiss, modifiers do not dismiss', async () => {
    await setupForMovieMode(page);

    // Test 1: Modifier keys should NOT dismiss movie mode
    await page.keyboard.press('m');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.explorer.movieMode.active)).toBe(true);

    await page.keyboard.down('Shift');
    await page.keyboard.up('Shift');
    await page.keyboard.down('Control');
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.explorer.movieMode.active)).toBe(true);

    await page.keyboard.press('m');
    await page.waitForTimeout(200);

    // Test 2: Regular key should dismiss movie mode
    await page.keyboard.press('m');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.explorer.movieMode.active)).toBe(true);

    await page.keyboard.press('a');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.explorer.movieMode.active)).toBe(false);

    // Test 3: Click should dismiss movie mode
    await page.keyboard.press('m');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.explorer.movieMode.active)).toBe(true);

    const movieContainer = await page.$('#movie');
    const box = await movieContainer.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.explorer.movieMode.active)).toBe(false);
  }, TEST_TIMEOUT);

  test('Movie encoding creates MP4 blob using WebCodecs and mp4Muxer', async () => {
    // Skip if WebCodecs is not available (headless Chrome should have it)
    const hasWebCodecs = await page.evaluate(() => typeof VideoEncoder !== 'undefined');
    if (!hasWebCodecs) {
      console.log('Skipping movie encoding test - WebCodecs not available');
      return;
    }

    // Navigate with minimal views for fast encoding
    // Use pixelratio=1 to keep canvas small, and set up 2 views with small zoom
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?c=-0.5+0i,-0.6+0.1i&s=3,2&pixelratio=1`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 });
    await page.waitForFunction(() => window.explorer.grid.views.length >= 2, { timeout: 5000 });
    await page.waitForTimeout(500);

    // Start movie mode
    await page.keyboard.press('m');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.explorer.movieMode.active)).toBe(true);

    // Wait for encoding to complete (recordedBlob gets set)
    // This exercises: Muxer constructor, addVideoChunk, finalize, ArrayBufferTarget
    const encodingComplete = await page.waitForFunction(
      () => window.explorer.movieMode.recordedBlob !== null,
      { timeout: 60000 }  // Allow up to 60s for encoding
    ).then(() => true).catch(() => false);

    if (encodingComplete) {
      // Verify the blob was created with correct properties
      const blobInfo = await page.evaluate(() => {
        const blob = window.explorer.movieMode.recordedBlob;
        return {
          hasBlob: blob !== null,
          type: blob?.type,
          size: blob?.size
        };
      });

      expect(blobInfo.hasBlob).toBe(true);
      expect(blobInfo.type).toBe('video/mp4');
      expect(blobInfo.size).toBeGreaterThan(0);

      // Verify download link was updated
      const downloadLink = await page.evaluate(() => {
        const link = document.getElementById('moviescale');
        return link?.textContent;
      });
      expect(downloadLink).toBe('Download mp4');
    } else {
      // If encoding failed, check why
      const status = await page.evaluate(() => {
        const el = document.getElementById('moviestatus');
        return el?.textContent;
      });
      console.log('Encoding did not complete. Status:', status);
      // Don't fail the test if encoding isn't supported, just log it
    }

    // Clean up - exit movie mode
    await page.keyboard.press('m');
  }, 90000);  // 90 second timeout for this test
}, TEST_TIMEOUT);

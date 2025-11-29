/**
 * Integration tests for language/internationalization
 */

const path = require('path');
const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, waitForViewReady } = require('./test-utils');

describe('Language/Internationalization Tests', () => {
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

  test('Should show correct language based on lang URL parameter', async () => {
    // Test 1: Default (no lang parameter) should show English
    const defaultLang = await page.evaluate(() => {
      const enDiv = document.querySelector('#text [lang="en"]');
      const esDiv = document.querySelector('#text [lang="es"]');
      return {
        enVisible: enDiv && window.getComputedStyle(enDiv).display !== 'none',
        esVisible: esDiv && window.getComputedStyle(esDiv).display !== 'none'
      };
    }, TEST_TIMEOUT);
    expect(defaultLang.enVisible).toBe(true);
    expect(defaultLang.esVisible).toBe(false);

    // Test 2: Spanish (lang=es)
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?lang=es`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 }, TEST_TIMEOUT);
    await page.waitForTimeout(200);
    const esLang = await page.evaluate(() => {
      const enDiv = document.querySelector('#text [lang="en"]');
      const esDiv = document.querySelector('#text [lang="es"]');
      return {
        enVisible: enDiv && window.getComputedStyle(enDiv).display !== 'none',
        esVisible: esDiv && window.getComputedStyle(esDiv).display !== 'none',
        helpText: esDiv ? esDiv.textContent : null
      };
    }, TEST_TIMEOUT);
    expect(esLang.enVisible).toBe(false);
    expect(esLang.esVisible).toBe(true);
    expect(esLang.helpText).toContain('Explorador');
    expect(esLang.helpText).toContain('Mandelbrot');

    // Test 3: Traditional Chinese (lang=zh-tw)
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?lang=zh-tw`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 }, TEST_TIMEOUT);
    await page.waitForTimeout(200);
    const zhTwLang = await page.evaluate(() => {
      const enDiv = document.querySelector('#text [lang="en"]');
      const zhTwDiv = document.querySelector('#text [lang="zh-TW"]');
      return {
        enVisible: enDiv && window.getComputedStyle(enDiv).display !== 'none',
        zhTwVisible: zhTwDiv && window.getComputedStyle(zhTwDiv).display !== 'none'
      };
    }, TEST_TIMEOUT);
    expect(zhTwLang.enVisible).toBe(false);
    expect(zhTwLang.zhTwVisible).toBe(true);

    // Test 4: Simplified Chinese (lang=zh)
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?lang=zh`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 }, TEST_TIMEOUT);
    await page.waitForTimeout(200);
    const zhLang = await page.evaluate(() => {
      const enDiv = document.querySelector('#text [lang="en"]');
      const zhDiv = document.querySelector('#text [lang="zh"]');
      return {
        enVisible: enDiv && window.getComputedStyle(enDiv).display !== 'none',
        zhVisible: zhDiv && window.getComputedStyle(zhDiv).display !== 'none'
      };
    }, TEST_TIMEOUT);
    expect(zhLang.enVisible).toBe(false);
    expect(zhLang.zhVisible).toBe(true);

    // Test 5: Unsupported language falls back to English
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?lang=xyz`);
    await page.waitForFunction(() => window.explorer !== undefined, { timeout: 10000 }, TEST_TIMEOUT);
    await page.waitForTimeout(200);
    const fallbackLang = await page.evaluate(() => {
      const enDiv = document.querySelector('#text [lang="en"]');
      return { enVisible: enDiv && window.getComputedStyle(enDiv).display !== 'none' };
    }, TEST_TIMEOUT);
    expect(fallbackLang.enVisible).toBe(true);
  }, TEST_TIMEOUT);

  test('Should preserve or omit lang parameter in generated URLs correctly', async () => {
    // Test 1: lang parameter should be preserved in generated URLs
    await page.goto(`file://${path.join(__dirname, '../../index.html')}?lang=es`);
    await page.waitForFunction(() => window.explorer?.urlHandler !== undefined, { timeout: 10000 }, TEST_TIMEOUT);
    await waitForViewReady(page);
    const urlWithLang = await page.evaluate(() => window.explorer.urlHandler.currenturl());
    expect(urlWithLang).toContain('lang=es');

    // Test 2: lang parameter should be omitted if not specified originally
    await page.goto(`file://${path.join(__dirname, '../../index.html')}`);
    await page.waitForFunction(() => window.explorer?.urlHandler !== undefined, { timeout: 10000 }, TEST_TIMEOUT);
    await waitForViewReady(page);
    const urlWithoutLang = await page.evaluate(() => window.explorer.urlHandler.currenturl());
    expect(urlWithoutLang).not.toContain('lang=');
  }, TEST_TIMEOUT);
}, TEST_TIMEOUT);

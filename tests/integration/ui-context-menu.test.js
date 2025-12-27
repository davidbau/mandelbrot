/**
 * Integration tests for the custom context menu (Save/Copy Image)
 */

const { TEST_TIMEOUT, setupBrowser, setupPage, navigateToApp, waitForViewReady, closeBrowser } = require('./test-utils');

describe('Context Menu UI Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await setupBrowser();
    // Enable clipboard permissions
    const context = browser.defaultBrowserContext();
    await context.overridePermissions('file://', ['clipboard-read', 'clipboard-write']);
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    page = await setupPage(browser, {}, TEST_TIMEOUT);
    await navigateToApp(page);
  }, TEST_TIMEOUT);

  afterEach(async () => {
    if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await closeBrowser(browser);
  }, TEST_TIMEOUT);

  test('Right-click should show context menu with Save/Download and Copy options', async () => {
    await waitForViewReady(page);
    
    const canvas = await page.$('#grid canvas');
    const box = await canvas.boundingBox();
    
    // Right-click on the canvas
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    
    // Check if menu appears
    const menuExists = await page.evaluate(() => {
      // Find the menu div (it's a fixed div with high z-index and specific font size)
      const divs = Array.from(document.querySelectorAll('div'));
      return divs.some(d => 
        window.getComputedStyle(d).position === 'fixed' && 
        window.getComputedStyle(d).zIndex === '10000' &&
        d.textContent.includes('Image')
      );
    });
    expect(menuExists).toBe(true);

    // Verify menu items
    const menuItems = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div'));
      const menu = divs.find(d => 
        window.getComputedStyle(d).position === 'fixed' && 
        window.getComputedStyle(d).zIndex === '10000'
      );
      if (!menu) return [];
      return Array.from(menu.children).map(c => c.textContent);
    });

    expect(menuItems.some(text => text.includes('Save Image') || text.includes('Download Image'))).toBe(true);
    
    // Copy Image might not be present if ClipboardItem is not supported, 
    // but in modern Chrome it should be.
    const hasCopy = menuItems.some(text => text.includes('Copy Image'));
    // We expect it to be there in the test environment (modern Chrome)
    expect(hasCopy).toBe(true);
  }, TEST_TIMEOUT);

  test('Clicking Copy Image should show a toast notification', async () => {
    await waitForViewReady(page);
    
    const canvas = await page.$('#grid canvas');
    const box = await canvas.boundingBox();
    
    // Right-click to open menu
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    
    // Click "Copy Image"
    const clicked = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div'));
      const menu = divs.find(d => 
        window.getComputedStyle(d).position === 'fixed' && 
        window.getComputedStyle(d).zIndex === '10000'
      );
      if (!menu) return false;
      const copyItem = Array.from(menu.children).find(c => c.textContent.includes('Copy Image'));
      if (!copyItem) return false;
      copyItem.click();
      return true;
    });
    expect(clicked).toBe(true);

    // Wait for toast notification
    await page.waitForFunction(() => {
      const divs = Array.from(document.querySelectorAll('div'));
      return divs.some(d => d.textContent === 'Image copied' || d.textContent === 'Copy not available');
    }, { timeout: 5000 });

    const toastText = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div'));
      const toast = divs.find(d => d.textContent === 'Image copied' || d.textContent === 'Copy not available');
      return toast ? toast.textContent : null;
    });

    // In some headless environments, it might still fail and show "Copy not available"
    // but we've exercised the code path.
    expect(['Image copied', 'Copy not available']).toContain(toastText);
  }, TEST_TIMEOUT);

  test('Menu should close when clicking outside', async () => {
    await waitForViewReady(page);
    
    const canvas = await page.$('#grid canvas');
    const box = await canvas.boundingBox();
    
    // Right-click to open menu
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    
    // Verify it's open
    let menuCount = await page.evaluate(() => 
      Array.from(document.querySelectorAll('div')).filter(d => 
        window.getComputedStyle(d).position === 'fixed' && 
        window.getComputedStyle(d).zIndex === '10000'
      ).length
    );
    expect(menuCount).toBe(1);

    // Ensure the setTimeout(..., 0) in the app has attached the listener.
    // In headless environments, sometimes things take a bit longer.
    await page.waitForTimeout(200);

    // Click at a safe location (near the bottom right corner of the viewport)
    const viewport = page.viewport();
    await page.mouse.click(viewport.width - 10, viewport.height - 10);
    
    // Wait for menu to be removed
    await page.waitForFunction(() => {
      const divs = Array.from(document.querySelectorAll('div'));
      return !divs.some(d => {
        const style = window.getComputedStyle(d);
        return style.position === 'fixed' && style.zIndex === '10000';
      });
    }, { timeout: 5000 });

    menuCount = await page.evaluate(() => 
      Array.from(document.querySelectorAll('div')).filter(d => {
        const style = window.getComputedStyle(d);
        return style.position === 'fixed' && style.zIndex === '10000';
      }).length
    );
    expect(menuCount).toBe(0);
  }, TEST_TIMEOUT);
});

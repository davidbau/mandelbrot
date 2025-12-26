const puppeteer = require('puppeteer');

const BOARDS = ['gpu', 'gpuz', 'gpua'];

(async () => {
  const browser = await puppeteer.launch({ headless: true });

  for (const board of BOARDS) {
    const page = await browser.newPage();
    const logs = [];
    page.on('console', msg => logs.push(msg.text()));

    const url = 'file://' + process.cwd() + '/index.html?z=1e4&board=' + board + '&c=-0.75+0.001i&debug=dims:100x100';
    await page.goto(url);

    try {
      await page.waitForFunction('window.explorer', { timeout: 15000 });
      await new Promise(r => setTimeout(r, 5000));

      const errors = logs.filter(l => l.includes('Error') || l.includes('error'));
      if (errors.length > 0) {
        console.log(`${board}: ERRORS FOUND`);
        errors.forEach(e => console.log(`  ${e}`));
        process.exitCode = 1;
      } else {
        const result = await page.evaluate(() => {
          const view = window.explorer?.grid?.views?.[0];
          return {
            boardType: view?.boardType,
            it: view?.it,
            un: view?.un,
            di: view?.di
          };
        });
        console.log(`${board}: OK - ${result.boardType} it=${result.it} un=${result.un} di=${result.di}`);
      }
    } catch (err) {
      console.log(`${board}: ${err.message}`);
      const errors = logs.filter(l => l.includes('Error') || l.includes('error'));
      errors.forEach(e => console.log(`  ${e}`));
      process.exitCode = 1;
    }

    await page.close();
  }

  await browser.close();
})();

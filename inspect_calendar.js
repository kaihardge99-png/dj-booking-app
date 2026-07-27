const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const page = await browser.newPage({ userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36' });
  await page.goto('https://calendar.app.google/LkuhqT6XWh8MdfEWA', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(15000);
  const labels = await page.$$eval('button[aria-label]', bs => bs.map(b => ({aria: b.getAttribute('aria-label'), text: b.innerText.slice(0,120), outer: b.outerHTML.slice(0,500)})));
  const controls = await page.$$eval('button', bs => bs.map(b => ({text: (b.innerText||'').slice(0,120), aria: b.getAttribute('aria-label'), role: b.getAttribute('role'), outer: (b.outerHTML||'').slice(0,500)})).filter(x => /(next|forward|chevron|arrow|month|calendar)/i.test(x.text + ' ' + (x.aria||''))));
  const body = await page.$eval('body', b => (b.innerText||'').slice(0,5000));
  console.log('BODY_SNIPPET:\n', body);
  console.log('LABEL_COUNT', labels.length);
  console.log('LABELS', JSON.stringify(labels.slice(0,80), null, 2));
  console.log('CONTROL_COUNT', controls.length);
  console.log('CONTROLS', JSON.stringify(controls.slice(0,80), null, 2));
  await browser.close();
})();

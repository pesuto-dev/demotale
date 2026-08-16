import { test, expect } from '@pesuto/demotale';

test('A first recording', async ({ page, demo }) => {
  // One full page load, at the start. Everything after this happens by clicking, the way a person
  // would: loading a deep URL directly asks the server for assets relative to that path, and in a
  // single-page app that often loads nothing at all.
  await page.goto('/');

  await demo.card('Your app', 'A first recording made by demotale');
  await demo.hideCard();

  await demo.say('Everything you see here is scripted, so it can be recorded again tomorrow.');

  await demo.step('The app opens.', async () => {
    await expect(page).toHaveTitle(/./);
  });

  // Point at something real and the recording starts being useful:
  //
  // await demo.step('This number comes from our own cache.', async () => {
  //   await demo.spotlight(page.getByTestId('cache-age'), 2400);
  //   await demo.clearSpotlight();
  // });
  //
  // await demo.step('Opening it fetches the record live.', async () => {
  //   await demo.click(page.getByRole('link', { name: 'Open' }));
  //   await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
  // });
});

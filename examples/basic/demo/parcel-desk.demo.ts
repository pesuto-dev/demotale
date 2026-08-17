import { test, expect } from '@pesuto/demotale';

test('A tour of the parcel desk', async ({ page, demo }) => {
  await demo.card('Parcel desk', 'Recorded by demotale, from a script in this repository');
  await page.goto('/');
  await demo.hideCard();

  // Says out loud what the viewer is looking at. A demo that overstates is worse than no demo.
  await demo.note('Made-up data. No real parcels were harmed.');

  await demo.say('Nobody recorded this. It is a scenario file, and CI can run it again tomorrow.');

  demo.chapter('What is waiting');

  await demo.step('The desk opens on what is waiting.', async () => {
    await demo.spotlight(page.getByTestId('waiting'), 2_000);
    await demo.clearSpotlight();
  });

  await demo.step('The list says how old it is, so nobody has to guess.', async () => {
    await demo.spotlight(page.getByTestId('cache-age'), 2_000);
    await demo.clearSpotlight();
  });

  demo.chapter('Tracking one parcel');

  await demo.step('Tracking a parcel is one field, further down the page.', async () => {
    await demo.type(page.getByLabel('Track a parcel'), 'PD-1041');
    await demo.click(page.getByRole('button', { name: 'Track' }));

    // Stands in for the real thing: a wait worth naming rather than filming.
    await demo.wait('Asking the carrier', page.waitForTimeout(1_200));
    await expect(page.getByTestId('result')).toContainText('Rotterdam');
  });

  await demo.step('And the answer comes back where it was asked for.', async () => {
    await demo.spotlight(page.getByTestId('result'), 2_400);
    await demo.clearSpotlight();
  });

  await demo.card('That is the whole tour', 'It came out of demo/parcel-desk.demo.ts');
});

import { test, expect } from '@playwright/test';

test('rapid touch release and cancellation preserve the tree and its next drag', async ({
  page,
  context,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== 'chromium' || !testInfo.project.use.hasTouch,
    'Trusted touch transport requires the Chromium phone project.',
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const input = await context.newCDPSession(page);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#view=tree');
    // Phones open the tree as a list; this check needs the diagram.
    const diagram = page.getByRole('button', { name: 'Show diagram' });
    await expect(page.locator('.tree-viewport').or(diagram)).toBeVisible();
    if (await diagram.isVisible()) await diagram.click();
    const viewport = page.locator('.tree-viewport');
    const world = page.locator('.tree-world');
    await expect(viewport).toBeVisible();
    await viewport.scrollIntoViewIfNeeded();
    for (const finish of ['touchEnd', 'touchCancel', 'touchEnd'] as const) {
      const start = await viewport.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        for (
          let y = bounds.top + 20;
          y < Math.min(bounds.bottom, innerHeight) - 50;
          y += 35
        )
          for (let x = bounds.left + 20; x < bounds.right - 100; x += 35) {
            const target = document.elementFromPoint(x, y);
            if (
              target?.closest('.tree-viewport') === element &&
              !target.closest('button')
            )
              return { x, y };
          }
        throw new Error('No uncovered tree area available for a drag');
      });
      const before = await world.getAttribute('style');
      await input.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...start, id: 1 }],
      });
      // Awaiting each movement separately masks the release/render race.
      const moves = Array.from({ length: 6 }, (_, index) =>
        input.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            {
              x: start.x + (index + 1) * 12,
              y: start.y + (index + 1) * 4,
              id: 1,
            },
          ],
        }),
      );
      moves.push(
        input.send('Input.dispatchTouchEvent', {
          type: finish,
          touchPoints: [],
        }),
      );
      await Promise.all(moves);
      await expect(viewport).toBeVisible();
      await expect(viewport).not.toHaveClass(/dragging/);
      await expect(world).not.toHaveAttribute('style', before!);
      expect(errors).toEqual([]);
    }
    await page
      .getByRole('button', { name: 'Fit all relatives in view' })
      .click();
    await expect(page.locator('.tree-person').first()).toBeVisible();
    // Fitting animates the tree. Choose the touch points only once it has
    // settled, or a person's card can slide under a finger.
    await expect
      .poll(async () => {
        const first = await world.getAttribute('style');
        await page.waitForTimeout(150);
        return first === (await world.getAttribute('style'));
      })
      .toBe(true);
    const pair = await viewport.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      for (
        let y = bounds.top + 25;
        y < Math.min(bounds.bottom, innerHeight) - 70;
        y += 30
      ) {
        const a = { x: bounds.left + 25, y, id: 1 };
        const b = { x: bounds.right - 45, y, id: 2 };
        if (
          [a, b].every(({ x, y }) => {
            const target = document.elementFromPoint(x, y);
            return (
              target?.closest('.tree-viewport') === element &&
              !target.closest('button')
            );
          })
        )
          return [a, b];
      }
      throw new Error('No uncovered tree area available for a pinch');
    });
    const [a, b] = pair;
    await input.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [a],
    });
    await input.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: pair,
    });
    const beforePinch = await world.getAttribute('style');
    const moved = [
      { ...a, x: a.x - 12 },
      { ...b, x: b.x + 12 },
    ];
    await input.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: moved,
    });
    await expect(world).not.toHaveAttribute('style', beforePinch!);
    const remaining = moved[1];
    await input.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      // CDP names the lifted contact here, not the one still touching.
      touchPoints: [moved[0]],
    });
    await expect(viewport).toHaveClass(/dragging/);
    const beforePan = await world.getAttribute('style');
    await input.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ ...remaining, x: remaining.x - 25, y: remaining.y + 25 }],
    });
    await expect(world).not.toHaveAttribute('style', beforePan!);
    await input.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect(viewport).not.toHaveClass(/dragging/);
    expect(
      await world.evaluate((element) => {
        const t = new DOMMatrix(getComputedStyle(element).transform);
        return [t.a, t.b, t.c, t.d, t.e, t.f].every(Number.isFinite);
      }),
    ).toBe(true);
    await page.getByRole('button', { name: 'Show family list' }).click();
    await expect(page.locator('.tree-readable')).toBeVisible();
    await page.getByRole('button', { name: 'Show diagram' }).click();
    await expect(viewport).toBeVisible();
  }
  expect(errors).toEqual([]);
});

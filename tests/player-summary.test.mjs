import test from "node:test";
import assert from "node:assert/strict";
import { aggregatePlayerPreferences, reliableRoleScore } from "../lib/player-summary.mjs";

test("summary keeps the full hero and augment population", () => {
  const matches = Array.from({ length: 15 }, (_, index) => ({
    id: `FULL-${index}`,
    champion: `英雄${index}`,
    win: index % 2 === 0,
    augments: [`海克斯${index}`],
    items: [`装备${index % 3}`],
  }));
  const summary = aggregatePlayerPreferences(matches);
  assert.equal(summary.heroes.length, 15);
  assert.equal(summary.heroes.reduce((total, hero) => total + hero.games, 0), 15);
  assert.equal(summary.augments.length, 15);
  assert.equal(summary.augments.reduce((total, augment) => total + augment.picks, 0), 15);
  assert.equal(summary.favoriteItems.reduce((total, item) => total + item.games, 0), 15);
});

test("role reliability prevents one high score game from beating stable volume", () => {
  assert.ok(reliableRoleScore(70, 12) > reliableRoleScore(95, 1));
  assert.equal(reliableRoleScore(80, 0), 0);
});

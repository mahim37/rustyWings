import { describe, expect, it } from 'vitest';
import { History, type Sample } from './history';

function sample(tick: number, herb: number): Sample {
  return { tick, herb, pred: 0, plants: 0, fovH: 0, fovP: 0, rangeH: 0, rangeP: 0, speedH: 0, speedP: 0, births: tick, deaths: 0, predated: 0 };
}

describe('History', () => {
  it('ignores out-of-order samples', () => {
    const h = new History();
    h.push(sample(25, 1));
    h.push(sample(25, 2));
    h.push(sample(0, 3));
    expect(h.length).toBe(1);
    expect(h.latest?.herb).toBe(1);
  });

  it('finds the sample nearest N ticks back', () => {
    const h = new History();
    for (let t = 0; t <= 1000; t += 25) h.push(sample(t, t));
    expect(h.at(300)?.tick).toBe(700);
    expect(h.at(5000)?.tick).toBe(0);
    expect(h.at(0)?.tick).toBe(1000);
  });

  it('truncates after a rewind', () => {
    const h = new History();
    for (let t = 0; t <= 500; t += 25) h.push(sample(t, t));
    h.truncateAfter(210);
    expect(h.latest?.tick).toBe(200);
    h.push(sample(225, 1));
    expect(h.length).toBe(10);
  });

  it('buckets a window and leaves NaN where history is missing', () => {
    const h = new History();
    for (let t = 0; t <= 500; t += 25) h.push(sample(t, 10));
    const w = h.window('herb', 1000, 10);
    expect(w.values.length).toBe(10);
    // Buckets before tick 0 are empty; tick 0 itself lands in bucket 4 (-100, 0].
    expect(Number.isNaN(w.values[0])).toBe(true);
    expect(Number.isNaN(w.values[3])).toBe(true);
    expect(w.values[4]).toBe(10);
    expect(w.values[9]).toBe(10);
    expect(w.ticks[9]).toBe(500);
  });

  it('averages within buckets, except the last which is the latest sample', () => {
    const h = new History();
    h.push(sample(25, 0));
    h.push(sample(50, 10));
    h.push(sample(75, 20));
    h.push(sample(100, 30));
    const w = h.window('herb', 100, 2);
    expect(w.values[0]).toBe(5);
    expect(w.values[1]).toBe(30);
  });

  it('drops the oldest samples past capacity', () => {
    const h = new History(3);
    for (let t = 25; t <= 125; t += 25) h.push(sample(t, t));
    expect(h.length).toBe(3);
    expect(h.at(1e9)?.tick).toBe(75);
  });
});

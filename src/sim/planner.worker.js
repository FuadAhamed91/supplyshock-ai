// Runs the AI planner off the main thread so the 3D map stays smooth while it works.
import { searchPlansAsync } from './planner.js';

self.onmessage = async (e) => {
  const { scenario, at, runs } = e.data;
  const result = await searchPlansAsync(scenario, at, {
    runs,
    onProgress: (p, opt) => self.postMessage({ type: 'progress', p, opt: { actions: opt.actions, stats: opt.stats } }),
  });
  self.postMessage({ type: 'done', result });
};

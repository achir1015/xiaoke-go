// 背景執行緒：小柯 JS 圍棋引擎
import { search } from './engine-js.js';

self.onmessage = (e) => {
  const { id, opts } = e.data;
  try {
    const r = search(opts);
    self.postMessage({ id, ok: true, r });
  } catch (err) {
    self.postMessage({ id, ok: false, e: String((err && err.stack) || err) });
  }
};

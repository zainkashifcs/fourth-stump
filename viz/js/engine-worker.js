// One pooled engine instance (ADR-016), started by loadEngine in engine-wasm.js. Runs as a module
// Web Worker in the page, or under Node's worker_threads in the tests.
import { createInstance } from './engine-wasm.js';

const port = typeof globalThis.WorkerGlobalScope === 'function' ? globalThis : (await import('node:worker_threads')).parentPort;
const listen = (handle) => (port.on ? port.on('message', handle) : port.addEventListener('message', (e) => handle(e.data)));

try {
  const engine = await createInstance();
  listen(({ id, values, first, count, seed }) => port.postMessage({ id, ...engine.simulate(values, first, count, seed) }));
  port.postMessage({ ready: true });
} catch (error) {
  port.postMessage({ failed: `engine worker could not load the engine: ${error.message}` });
}

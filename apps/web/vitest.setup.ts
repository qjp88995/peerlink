import { Blob as NodeBlob } from 'node:buffer';

// jsdom 25's Blob lacks async read methods (arrayBuffer/text/stream), which the
// transfer writers rely on. Replace the global with Node's spec-compliant Blob.
if (
  typeof Blob === 'undefined' ||
  typeof Blob.prototype.arrayBuffer !== 'function'
) {
  (globalThis as { Blob: unknown }).Blob = NodeBlob;
}

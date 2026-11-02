import { pipeline, env } from '../../../node_modules/@xenova/transformers/dist/transformers.js';

env.allowLocalModels = false;
env.useBrowserCache = true;

let extractor = null;
let isReady = false;
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

self.addEventListener('message', async (event) => {
  const { action, id, text, texts } = event.data;

  try {
    if (action === 'initialize') {
      if (!extractor) {
        self.postMessage({ status: 'progress', message: 'Loading MiniLM-L6-v2…' });
        extractor = await pipeline('feature-extraction', MODEL_NAME, {
          progress_callback: (x) => {
            self.postMessage({ status: 'download_progress', data: x });
          },
        });
        isReady = true;
        self.postMessage({ status: 'ready', message: 'Recall neural engine online' });
      } else {
        self.postMessage({ status: 'ready', message: 'Engine already online' });
      }
    } else if (action === 'embed') {
      if (!isReady) throw new Error('Extractor not initialized');
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      self.postMessage({
        status: 'success',
        action: 'embed',
        id,
        originalQueryText: event.data.originalQueryText,
        embedding: Array.from(output.data),
      });
    } else if (action === 'embed_batch') {
      if (!isReady) throw new Error('Extractor not initialized');
      const results = [];
      let processed = 0;
      for (let i = 0; i < texts.length; i++) {
        const out = await extractor(texts[i].content, { pooling: 'mean', normalize: true });
        results.push({
          chunkId: texts[i].chunkId,
          relPath: texts[i].relPath,
          text: texts[i].text,
          embedding: Array.from(out.data),
        });
        processed++;
        if (processed % 5 === 0 || processed === texts.length) {
          self.postMessage({
            status: 'batch_progress',
            processed,
            total: texts.length,
          });
        }
      }
      self.postMessage({
        status: 'success',
        action: 'embed_batch',
        embeddings: results,
      });
    }
  } catch (error) {
    self.postMessage({ status: 'error', error: error.message, action });
  }
});

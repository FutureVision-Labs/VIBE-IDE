/**
 * Project Recall v1 — MiniLM embeddings via Web Worker (Gemzy pattern).
 */
(function () {
  let worker = null;
  let ready = false;
  let initPromise = null;

  function getWorker() {
    if (worker) return worker;
    worker = new Worker('workers/rag-worker.js', { type: 'module' });
    worker.onerror = (e) => console.error('[RecallNeural]', e.message || e);
    return worker;
  }

  function ensureReady() {
    if (ready) return Promise.resolve(true);
    if (initPromise) return initPromise;

    initPromise = new Promise((resolve, reject) => {
      const w = getWorker();
      const onMsg = (event) => {
        const data = event.data;
        if (data.status === 'ready') {
          ready = true;
          w.removeEventListener('message', onMsg);
          console.log('🧠 Recall neural engine ready');
          resolve(true);
        } else if (data.status === 'error') {
          w.removeEventListener('message', onMsg);
          reject(new Error(data.error || 'Worker error'));
        } else if (data.status === 'progress') {
          console.log('🧠', data.message);
        }
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ action: 'initialize' });
    }).catch((err) => {
      initPromise = null;
      console.warn('Recall neural init failed:', err);
      return false;
    });

    return initPromise;
  }

  function embedQuery(text) {
    return new Promise(async (resolve, reject) => {
      const ok = await ensureReady();
      if (!ok) {
        resolve(null);
        return;
      }
      const w = getWorker();
      const id = `q-${Date.now()}`;
      const onMsg = (event) => {
        const data = event.data;
        if (data.action === 'embed' && data.id === id) {
          w.removeEventListener('message', onMsg);
          if (data.status === 'success') resolve(data.embedding);
          else reject(new Error(data.error || 'embed failed'));
        }
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ action: 'embed', id, text, originalQueryText: text });
    });
  }

  function embedBatch(chunks) {
    return new Promise(async (resolve, reject) => {
      const ok = await ensureReady();
      if (!ok) {
        resolve([]);
        return;
      }
      const texts = chunks.map((c) => ({
        chunkId: c.chunkId,
        relPath: c.relPath,
        text: c.text,
        content: `[${c.relPath}]\n${c.text}`.slice(0, 2500),
      }));
      const w = getWorker();
      const onMsg = (event) => {
        const data = event.data;
        if (data.status === 'batch_progress') {
          console.log(`🧠 Indexing ${data.processed}/${data.total}…`);
        } else if (data.action === 'embed_batch' && data.status === 'success') {
          w.removeEventListener('message', onMsg);
          resolve(data.embeddings || []);
        } else if (data.status === 'error') {
          w.removeEventListener('message', onMsg);
          reject(new Error(data.error || 'batch embed failed'));
        }
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ action: 'embed_batch', texts });
    });
  }

  async function syncProjectIndex(projectPath, forceRebuild = false) {
    if (!window.electronAPI?.recallChunks || !projectPath) return false;
    try {
      const meta = await window.electronAPI.recallChunks(projectPath);
      if (!meta.success || !meta.chunks?.length) return false;
      if (!forceRebuild && !meta.needsRebuild) {
        console.log('🧠 Recall index cache hit (fingerprint match)');
        if (typeof window.refreshRecallStatus === 'function') {
          window.refreshRecallStatus();
        }
        return true;
      }
      if (typeof showToast === 'function') {
        showToast(`🧠 Building neural recall index (${meta.chunks.length} chunks)…`, 'info', 4000);
      }
      const embeddings = await embedBatch(meta.chunks);
      if (!embeddings.length) return false;
      const entries = embeddings.map((e) => ({
        chunkId: e.chunkId,
        relPath: e.relPath,
        text: e.text,
        embedding: e.embedding,
      }));
      await window.electronAPI.recallSaveIndex(projectPath, meta.fingerprint, entries);
      console.log('🧠 Recall index saved:', entries.length, 'chunks');
      if (typeof showToast === 'function') {
        showToast(`🧠 Project Recall v1 indexed ${entries.length} chunks`, 'success', 3000);
      }
      if (typeof window.refreshRecallStatus === 'function') {
        window.refreshRecallStatus();
      }
      return true;
    } catch (err) {
      console.warn('Recall index sync failed:', err);
      return false;
    }
  }

  window.RecallNeural = {
    ensureReady,
    embedQuery,
    embedBatch,
    syncProjectIndex,
    isReady: () => ready,
  };
})();

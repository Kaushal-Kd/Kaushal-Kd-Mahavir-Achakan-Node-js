/**
 * One-time download of the open-source DINOv2-small vision model used for
 * accessory visual search. Files land in apps/backend/models (gitignored) and are
 * copied to the server once; the running app never fetches models from the internet.
 *
 *   node scripts/download-visual-model.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AutoModel, AutoProcessor, env } from '@huggingface/transformers';

const here = path.dirname(fileURLToPath(import.meta.url));
env.cacheDir = path.resolve(here, '..', 'models');
env.allowRemoteModels = true;

const MODEL_ID = 'Xenova/dinov2-small';
await AutoProcessor.from_pretrained(MODEL_ID);
await AutoModel.from_pretrained(MODEL_ID, { dtype: 'q8' });
console.log(`Model ready in ${env.cacheDir}`);
process.exit(0);

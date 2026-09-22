import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveApiBaseUrl } from './apiBaseUrl.js';

test('local Vite uses the backend API, not the Vite origin', () => {
  assert.equal(
    resolveApiBaseUrl({
      protocol: 'http:',
      hostname: 'localhost',
      origin: 'http://localhost:5173',
    }),
    'http://localhost:4000/api'
  );
});

test('local Vite on 127.0.0.1 keeps the same loopback host for the API', () => {
  assert.equal(
    resolveApiBaseUrl({
      protocol: 'http:',
      hostname: '127.0.0.1',
      origin: 'http://127.0.0.1:5173',
    }),
    'http://127.0.0.1:4000/api'
  );
});

test('explicit localhost VITE_API_URL is rewritten to match a 127.0.0.1 page', () => {
  assert.equal(
    resolveApiBaseUrl({
      envUrl: 'http://localhost:4000/api',
      protocol: 'http:',
      hostname: '127.0.0.1',
      origin: 'http://127.0.0.1:5173',
    }),
    'http://127.0.0.1:4000/api'
  );
});

test('hosted web keeps same-origin /api', () => {
  assert.equal(
    resolveApiBaseUrl({
      protocol: 'https:',
      hostname: 'achakan.example.com',
      origin: 'https://achakan.example.com',
    }),
    'https://achakan.example.com/api'
  );
});

test('Electron file protocol falls back to the local API', () => {
  assert.equal(resolveApiBaseUrl({ protocol: 'file:', hostname: '', origin: 'file://' }), 'http://localhost:4000/api');
});

test('explicit local VITE_API_URL is rewritten to match the page hostname', () => {
  assert.equal(
    resolveApiBaseUrl({
      envUrl: 'http://127.0.0.1:4000/api',
      protocol: 'http:',
      hostname: 'localhost',
      origin: 'http://localhost:5173',
    }),
    'http://localhost:4000/api'
  );
});

test('hosted web ignores a leftover localhost VITE_API_URL', () => {
  assert.equal(
    resolveApiBaseUrl({
      envUrl: 'http://localhost:4000/api',
      protocol: 'https:',
      hostname: 'app.example.com',
      origin: 'https://app.example.com',
    }),
    'https://app.example.com/api'
  );
});

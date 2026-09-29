import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('health endpoints', () => {
  it('reports the process as live', async () => {
    const response = await request(createApp()).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns a structured 404', async () => {
    const response = await request(createApp()).get('/missing');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: 'not_found' });
  });
});

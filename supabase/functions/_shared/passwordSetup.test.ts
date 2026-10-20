import { describe, expect, it } from 'vitest';
import { passwordSetupResponse } from './passwordSetup';

describe('password setup API guard', () => {
  it('blocks pending users using server-owned app metadata', async () => {
    const response = passwordSetupResponse({ app_metadata: { must_change_password: true } });
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: 'Choose a new password before accessing the app' });
  });
  it('preserves ordinary and completed accounts', () => {
    expect(passwordSetupResponse({})).toBeNull();
    expect(passwordSetupResponse({ app_metadata: { must_change_password: false } })).toBeNull();
  });
});

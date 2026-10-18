import { describe, expect, it } from 'vitest';
import { redact } from '../src/main/redact';

describe('redact', () => {
  it('removes common credential shapes', () => {
    const s = redact(
      'Authorization: Bearer abc.def.ghi123456 refresh_token=1//0gAbcdefghijklmnopqrstuvwxyz api_key: "sk-ABCDEFGHIJKLMNOPQRST" ya29.a0AfH6SMBxyz code=4/0AX4XfWh',
    );
    expect(s).not.toMatch(/abc\.def|0gAbcdef|ABCDEFGHIJKLMNOP|a0AfH6|0AX4XfWh/);
    expect(s).toContain('[REDACTED]');
  });

  it('leaves ordinary text alone', () => {
    expect(redact('ffmpeg exited with code 1')).toBe('ffmpeg exited with code 1');
  });
});

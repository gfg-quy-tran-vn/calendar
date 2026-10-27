import { describe, expect, it } from 'vitest';
import { withAlpha } from '@/lib/colors';

describe('withAlpha', () => {
  it('turns #rrggbb into an rgba() color', () => {
    expect(withAlpha('#3b82f6', 0.75)).toBe('rgba(59, 130, 246, 0.75)');
    expect(withAlpha('#FFFFFF', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
  });

  it('expands the #rgb shorthand', () => {
    expect(withAlpha('#f80', 0.5)).toBe('rgba(255, 136, 0, 0.5)');
  });

  it('returns anything it cannot parse unchanged', () => {
    expect(withAlpha('red', 0.5)).toBe('red');
    expect(withAlpha('rgb(1, 2, 3)', 0.5)).toBe('rgb(1, 2, 3)');
    expect(withAlpha('', 0.5)).toBe('');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { idleShutdown } from '../containers/idle-shutdown';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('source process idle shutdown', () => {
  it('stops a never-used process after one minute', () => {
    const stop = vi.fn(), idle = idleShutdown(stop);
    vi.advanceTimersByTime(59999); expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(stop).toHaveBeenCalledOnce(); idle.dispose();
  });
  it('does not expire while a download is unfinished', () => {
    const stop = vi.fn(), idle = idleShutdown(stop), finish = idle.begin();
    vi.advanceTimersByTime(120000); expect(stop).not.toHaveBeenCalled();
    finish(); vi.advanceTimersByTime(59999); expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(stop).toHaveBeenCalledOnce(); idle.dispose();
  });
  it('waits for overlapping downloads and tolerates finish plus socket-close events', () => {
    const stop = vi.fn(), idle = idleShutdown(stop), first = idle.begin(), second = idle.begin();
    first(); first(); vi.advanceTimersByTime(120000); expect(stop).not.toHaveBeenCalled();
    second(); vi.advanceTimersByTime(60000); expect(stop).toHaveBeenCalledOnce(); idle.dispose();
  });
  it('cancels the timer when the server has closed', () => {
    const stop = vi.fn(), idle = idleShutdown(stop); idle.dispose();
    vi.advanceTimersByTime(60000); expect(stop).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_MEDIA_BYTES,
  blobToDataUrl,
  captureAudio,
  captureImage,
  detectMediaEnvironment,
  describeMedia,
  formatBytes,
  isOverCap,
  parseDataUrl,
  pickSupportedAudioMime,
  type GetUserMedia,
  type MediaRecorderCtor,
  type MediaRecorderLike,
  type MediaStreamLike,
} from './composer-media';

class FakeBlob {
  size: number;
  type: string;
  constructor(chunks: unknown[], opts: { type?: string } = {}) {
    this.type = opts.type ?? '';
    let total = 0;
    for (const c of chunks) {
      if (c instanceof FakeBlob) {
        total += c.size;
      } else if (typeof c === 'string') {
        total += c.length;
      } else if (c && typeof c === 'object' && 'size' in c) {
        total += (c as { size: number }).size;
      }
    }
    this.size = total;
  }
}

beforeEach(() => {
  (globalThis as { Blob?: unknown }).Blob = FakeBlob;
  (globalThis as { FileReader?: unknown }).FileReader = class {
    result: string | ArrayBuffer | null = null;
    error: Error | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: { size: number; type: string }) {
      // Synthesize a data URL with payload length proportional to blob size.
      const payload = 'A'.repeat(blob.size);
      this.result = `data:${blob.type};base64,${payload}`;
      this.onload?.();
    }
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseDataUrl', () => {
  it('splits mime + base64 + bytes', () => {
    const out = parseDataUrl('data:image/png;base64,iVBORw0KGgo=');
    expect(out.mime).toBe('image/png');
    expect(out.dataBase64).toBe('iVBORw0KGgo=');
    expect(out.bytes).toBe(8);
  });

  it('throws on missing comma', () => {
    expect(() => parseDataUrl('data:image/png;base64')).toThrow();
  });

  it('throws on missing meta separator', () => {
    expect(() => parseDataUrl('data:image/png,iVBORw0KGgo=')).toThrow();
  });

  it('throws on non-data URL', () => {
    expect(() => parseDataUrl('https://example.com')).toThrow();
  });
});

describe('blobToDataUrl', () => {
  it('reads via FileReader', async () => {
    const url = await blobToDataUrl(new Blob(['hello'], { type: 'text/plain' }) as unknown as Blob);
    expect(url.startsWith('data:text/plain;base64,')).toBe(true);
  });

  it('rejects when FileReader errors', async () => {
    (globalThis as { FileReader?: unknown }).FileReader = class {
      result: string | null = null;
      error: Error | null = new Error('boom');
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.onerror?.();
      }
    };
    await expect(blobToDataUrl({} as Blob)).rejects.toThrow('boom');
  });
});

describe('isOverCap', () => {
  it('compares bytes against default cap', () => {
    expect(isOverCap({ bytes: 100 })).toBe(false);
    expect(isOverCap({ bytes: MAX_MEDIA_BYTES + 1 })).toBe(true);
    expect(isOverCap({ bytes: MAX_MEDIA_BYTES })).toBe(false);
  });

  it('compares bytes against custom cap', () => {
    expect(isOverCap({ bytes: 50 }, 100)).toBe(false);
    expect(isOverCap({ bytes: 101 }, 100)).toBe(true);
  });

  it('falls back to dataUrl when bytes missing', () => {
    // 4 chars 'A' base64 → 3 decoded bytes (well below default cap).
    expect(isOverCap({ dataUrl: 'data:image/png;base64,AAAA' })).toBe(false);
    // Decoded bytes = floor(base64Len * 3 / 4); need ~12M base64 chars
    // to exceed the 8MB cap.
    const oversize = 'data:image/png;base64,' + 'A'.repeat(MAX_MEDIA_BYTES * 2);
    expect(isOverCap({ dataUrl: oversize })).toBe(true);
  });
});

describe('pickSupportedAudioMime', () => {
  it('returns first candidate supported by MediaRecorder.isTypeSupported', () => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = class {
      static isTypeSupported(mime: string) {
        return mime === 'audio/webm';
      }
    };
    expect(pickSupportedAudioMime(['audio/webm', 'audio/ogg'])).toBe('audio/webm');
    expect(pickSupportedAudioMime(['audio/ogg'])).toBeNull();
  });

  it('returns null when MediaRecorder missing', () => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = undefined;
    expect(pickSupportedAudioMime(['audio/webm'])).toBeNull();
  });

  it('respects recorderType filter', () => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = class {
      static isTypeSupported() {
        return true;
      }
    };
    expect(pickSupportedAudioMime(['audio/webm'], 'audio/ogg')).toBeNull();
  });
});

describe('detectMediaEnvironment', () => {
  it('reports unsupported when nothing is available', () => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = undefined;
    (globalThis as { navigator?: unknown }).navigator = {};
    expect(detectMediaEnvironment().isSupported).toBe(false);
  });

  it('reports supported when recorder + getUserMedia + FileReader exist', () => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = class {};
    (globalThis as { navigator?: unknown }).navigator = { mediaDevices: { getUserMedia: () => Promise.resolve() } };
    expect(detectMediaEnvironment().isSupported).toBe(true);
  });
});

describe('captureAudio', () => {
  function makeStream(): MediaStreamLike {
    return {
      getTracks: () => [{ stop: vi.fn(), kind: 'audio' }],
    };
  }

  function makeRecorderCtor(opts: { mime: string | null; fireError?: boolean }): MediaRecorderCtor {
    return class FakeRecorder implements MediaRecorderLike {
      mimeType: string;
      state: 'inactive' | 'recording' | 'paused' = 'inactive';
      ondataavailable: ((ev: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      private fired = false;
      constructor(_stream: MediaStreamLike, options?: { mimeType?: string }) {
        this.mimeType = options?.mimeType ?? '';
      }
      start(): void {
        this.state = 'recording';
      }
      stop(): void {
        this.state = 'inactive';
        if (this.fired) return;
        this.fired = true;
        if (opts.fireError) {
          this.onerror?.(new Error('recorder failed'));
          return;
        }
        this.ondataavailable?.({ data: new Blob(['x'.repeat(64)], { type: this.mimeType }) as unknown as Blob });
        this.onstop?.();
      }
      pause(): void {
        this.state = 'paused';
      }
      resume(): void {
        this.state = 'recording';
      }
    } as unknown as MediaRecorderCtor;
  }

  it('returns not_supported when recorder missing', async () => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = undefined;
    const result = await captureAudio();
    expect(result.kind).toBe('err');
    if (result.kind === 'err') expect(result.error.code).toBe('not_supported');
  });

  it('returns permission_denied when getUserMedia rejects', async () => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = class {
      static isTypeSupported() {
        return true;
      }
    };
    const getUserMedia: GetUserMedia = () => Promise.reject(new Error('denied'));
    const result = await captureAudio({
      getUserMedia,
      recorder: makeRecorderCtor({ mime: 'audio/webm' }),
    });
    expect(result.kind).toBe('err');
    if (result.kind === 'err') {
      expect(result.error.code).toBe('permission_denied');
      expect(result.error.source).toBe('mic');
    }
  });

  it('returns ok with audio payload on success', async () => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = class {
      static isTypeSupported() {
        return true;
      }
    };
    const recorder = makeRecorderCtor({ mime: 'audio/webm' });
    const getUserMedia: GetUserMedia = () => Promise.resolve(makeStream());
    // Drive the recorder from outside via an injected controller.
    const recRef: { current: MediaRecorderLike | null } = { current: null };
    const recorderFactory: MediaRecorderCtor = class extends (recorder as unknown as new (...args: any[]) => MediaRecorderLike) {
      constructor(stream: MediaStreamLike, options?: { mimeType?: string }) {
        super(stream, options);
        recRef.current = this;
      }
    } as unknown as MediaRecorderCtor;
    const promise = captureAudio({
      recorder: recorderFactory,
      getUserMedia,
      maxBytes: 1024,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(recRef.current).toBeDefined();
    recRef.current!.stop();
    const result = await promise;
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data.kind).toBe('audio');
      expect(result.data.source).toBe('mic');
      expect(result.data.bytes).toBeGreaterThan(0);
    }
  });

  it('returns oversize when payload exceeds cap', async () => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = class {
      static isTypeSupported() {
        return true;
      }
    };
    const recRef: { current: MediaRecorderLike | null } = { current: null };
    const bigRecorder: MediaRecorderCtor = class {
      mimeType = 'audio/webm';
      state: 'inactive' | 'recording' | 'paused' = 'recording';
      ondataavailable: ((ev: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      constructor(_stream: MediaStreamLike, _options?: { mimeType?: string }) {}
      start() {}
      stop() {
        // 4096 bytes of payload → 4096 bytes of base64 'A' chars → ~3072
        // decoded bytes (well above the 64-byte cap).
        this.ondataavailable?.({ data: new Blob(['x'.repeat(4096)], { type: 'audio/webm' }) as unknown as Blob });
        this.onstop?.();
      }
      pause() {}
      resume() {}
    } as unknown as MediaRecorderCtor;
    const captureFactory: MediaRecorderCtor = class extends (bigRecorder as unknown as new (...args: any[]) => MediaRecorderLike) {
      constructor(stream: MediaStreamLike, options?: { mimeType?: string }) {
        super(stream, options);
        recRef.current = this;
      }
    } as unknown as MediaRecorderCtor;
    const getUserMedia: GetUserMedia = () => Promise.resolve(makeStream());
    const promise = captureAudio({
      recorder: captureFactory,
      getUserMedia,
      maxBytes: 64,
    });
    await new Promise((r) => setTimeout(r, 5));
    recRef.current!.stop();
    const result = await promise;
    expect(result.kind).toBe('err');
    if (result.kind === 'err') expect(result.error.code).toBe('oversize');
  });
});

describe('captureImage', () => {
  function makeStream(): MediaStreamLike {
    return {
      getTracks: () => [{ stop: vi.fn(), kind: 'video' }],
    };
  }

  it('returns not_supported when getUserMedia missing', async () => {
    (globalThis as { navigator?: unknown }).navigator = {};
    const result = await captureImage();
    expect(result.kind).toBe('err');
    if (result.kind === 'err') expect(result.error.code).toBe('not_supported');
  });

  it('returns permission_denied when getUserMedia rejects', async () => {
    (globalThis as { navigator?: unknown }).navigator = {};
    const result = await captureImage({
      getUserMedia: () => Promise.reject(new Error('denied')),
    });
    expect(result.kind).toBe('err');
    if (result.kind === 'err') expect(result.error.code).toBe('permission_denied');
  });
});

describe('formatBytes', () => {
  it('renders B / KB / MB', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toMatch(/KB$/);
    expect(formatBytes(5 * 1024 * 1024)).toMatch(/MB$/);
  });
});

describe('describeMedia', () => {
  it('describes audio with duration', () => {
    const text = describeMedia({
      kind: 'audio',
      mime: 'audio/webm',
      dataUrl: 'data:audio/webm;base64,xx',
      bytes: 1024,
      capturedAt: 0,
      durationMs: 2500,
      source: 'mic',
    });
    expect(text).toMatch(/2\.5s/);
    expect(text).toMatch(/KB/);
  });

  it('describes image with mime suffix', () => {
    const text = describeMedia({
      kind: 'image',
      mime: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,xx',
      bytes: 2048,
      capturedAt: 0,
      source: 'camera',
    });
    expect(text).toContain('jpeg');
  });
});
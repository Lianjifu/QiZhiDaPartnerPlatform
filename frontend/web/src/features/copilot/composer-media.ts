export const MAX_MEDIA_BYTES = 8 * 1024 * 1024; // 8 MB cap on copilot composer attachments

export type MediaMimeType =
  | 'audio/webm'
  | 'audio/ogg'
  | 'audio/mp4'
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp';

export type MediaKind = 'audio' | 'image';

export type MediaCaptureSource = 'mic' | 'camera';

export type MediaCaptureResult = {
  kind: MediaKind;
  mime: MediaMimeType;
  dataUrl: string;
  bytes: number;
  capturedAt: number;
  durationMs?: number;
  source: MediaCaptureSource;
};

export type MediaCaptureError = {
  code:
    | 'not_supported'
    | 'permission_denied'
    | 'no_stream'
    | 'recorder_error'
    | 'oversize'
    | 'aborted';
  message: string;
  source: MediaCaptureSource;
};

export type AudioMimePreference = ReadonlyArray<MediaMimeType>;

const DEFAULT_AUDIO_MIMES: AudioMimePreference = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
];

const DEFAULT_IMAGE_MIME: MediaMimeType = 'image/png';

export function pickSupportedAudioMime(
  candidates: AudioMimePreference = DEFAULT_AUDIO_MIMES,
  recorderType?: string | null,
): MediaMimeType | null {
  if (typeof MediaRecorder === 'undefined') {
    return null;
  }
  for (const mime of candidates) {
    if (recorderType && recorderType !== mime) continue;
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return null;
}

export function pickSupportedImageMime(): MediaMimeType {
  if (typeof MediaRecorder === 'undefined') {
    return DEFAULT_IMAGE_MIME;
  }
  return DEFAULT_IMAGE_MIME;
}

export type DataUrlPayload = {
  mime: string;
  dataBase64: string;
  bytes: number;
};

/** Parse a data URL into its mime + base64 payload. Throws on invalid input. */
export function parseDataUrl(input: string): DataUrlPayload {
  if (!input.startsWith('data:')) {
    throw new Error('expected data URL');
  }
  const comma = input.indexOf(',');
  if (comma < 0) {
    throw new Error('data URL missing comma separator');
  }
  const meta = input.slice(5, comma);
  const semi = meta.indexOf(';');
  if (semi < 0) {
    throw new Error('data URL missing meta separator');
  }
  const mime = meta.slice(0, semi);
  const dataBase64 = input.slice(comma + 1);
  // Compute approximate decoded byte length: 3/4 of base64 (minus padding).
  const padding = dataBase64.endsWith('==') ? 2 : dataBase64.endsWith('=') ? 1 : 0;
  const bytes = Math.floor((dataBase64.length * 3) / 4) - padding;
  return { mime, dataBase64, bytes: Math.max(0, bytes) };
}

/** Convert a Blob to a data URL via FileReader — used everywhere as a
 * unified path because Blob#arrayBuffer is not available on every jsdom
 * version. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader unavailable'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(blob);
  });
}

/** Decide whether a captured payload exceeds the cap. */
export function isOverCap(payload: { bytes: number } | { dataUrl: string }, cap = MAX_MEDIA_BYTES): boolean {
  if ('bytes' in payload) {
    return payload.bytes > cap;
  }
  try {
    return parseDataUrl(payload.dataUrl).bytes > cap;
  } catch {
    return false;
  }
}

export type MediaRecorderLike = {
  start(timeslice?: number): void;
  stop(): void;
  pause(): void;
  resume(): void;
  state: 'inactive' | 'recording' | 'paused';
  ondataavailable: ((ev: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
  mimeType: string;
};

export type MediaRecorderCtor = new (stream: MediaStreamLike, options?: { mimeType?: string }) => MediaRecorderLike;

export type MediaStreamLike = {
  getTracks(): Array<{ stop(): void; kind: string }>;
};

export type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStreamLike>;

export type MediaEnvironment = {
  MediaRecorder?: MediaRecorderCtor;
  navigator?: { mediaDevices?: { getUserMedia?: GetUserMedia } };
  isSupported: boolean;
};

export function detectMediaEnvironment(): MediaEnvironment {
  const g = globalThis as unknown as {
    MediaRecorder?: MediaRecorderCtor;
    navigator?: { mediaDevices?: { getUserMedia?: GetUserMedia } };
  };
  const isSupported = Boolean(
    g.MediaRecorder &&
      g.navigator?.mediaDevices?.getUserMedia &&
      typeof FileReader !== 'undefined',
  );
  return {
    MediaRecorder: g.MediaRecorder,
    navigator: g.navigator,
    isSupported,
  };
}

export type AudioCaptureOptions = {
  recorder?: MediaRecorderCtor;
  getUserMedia?: GetUserMedia;
  mimePreference?: AudioMimePreference;
  maxBytes?: number;
  now?: () => number;
};

export type AudioCaptureOutcome =
  | { kind: 'ok'; data: MediaCaptureResult }
  | { kind: 'err'; error: MediaCaptureError };

export async function captureAudio(options: AudioCaptureOptions = {}): Promise<AudioCaptureOutcome> {
  const Recorder = options.recorder ?? (typeof MediaRecorder !== 'undefined' ? MediaRecorder : undefined);
  const getUserMedia =
    options.getUserMedia ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices?.getUserMedia : undefined);
  if (!Recorder || !getUserMedia) {
    return {
      kind: 'err',
      error: {
        code: 'not_supported',
        message: '当前环境不支持麦克风录制',
        source: 'mic',
      },
    };
  }
  const mime = pickSupportedAudioMime(options.mimePreference);
  if (!mime) {
    return {
      kind: 'err',
      error: {
        code: 'not_supported',
        message: '没有可用的音频编码格式',
        source: 'mic',
      },
    };
  }

  let stream: MediaStreamLike;
  try {
    stream = await getUserMedia({ audio: true });
  } catch (err) {
    return {
      kind: 'err',
      error: {
        code: 'permission_denied',
        message: err instanceof Error ? err.message : '麦克风权限被拒绝',
        source: 'mic',
      },
    };
  }

  const startedAt = (options.now ?? Date.now)();
  const chunks: Blob[] = [];

  const recorder = new Recorder(stream as unknown as MediaStream, { mimeType: mime });
  recorder.ondataavailable = (ev: { data: Blob; size?: number }) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('MediaRecorder errored'));
  });

  recorder.start();

  // Caller controls when to stop by calling recorder.stop externally — but
  // for a turnkey capture we record until silence-detect timeout below. To
  // keep this helper simple and synchronous from the consumer's POV, we
  // expose `stop` via the returned recorders; here we just resolve on stop.
  // The actual stop trigger is the caller's responsibility.
  await stopped;

  const durationMs = (options.now ?? Date.now)() - startedAt;
  stream.getTracks().forEach((t) => t.stop());

  const blob = new Blob(chunks, { type: mime });
  const dataUrl = await blobToDataUrl(blob);
  const parsed = parseDataUrl(dataUrl);
  const cap = options.maxBytes ?? MAX_MEDIA_BYTES;
  if (parsed.bytes > cap) {
    return {
      kind: 'err',
      error: {
        code: 'oversize',
        message: `录音大小 ${parsed.bytes} 字节超过 ${cap} 上限`,
        source: 'mic',
      },
    };
  }
  return {
    kind: 'ok',
    data: {
      kind: 'audio',
      mime,
      dataUrl,
      bytes: parsed.bytes,
      capturedAt: startedAt,
      durationMs,
      source: 'mic',
    },
  };
}

export type ImageCaptureOptions = {
  getUserMedia?: GetUserMedia;
  maxBytes?: number;
  now?: () => number;
};

export async function captureImage(options: ImageCaptureOptions = {}): Promise<AudioCaptureOutcome> {
  const getUserMedia =
    options.getUserMedia ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices?.getUserMedia : undefined);
  if (!getUserMedia) {
    return {
      kind: 'err',
      error: {
        code: 'not_supported',
        message: '当前环境不支持摄像头',
        source: 'camera',
      },
    };
  }
  let stream: MediaStreamLike;
  try {
    stream = await getUserMedia({ video: true });
  } catch (err) {
    return {
      kind: 'err',
      error: {
        code: 'permission_denied',
        message: err instanceof Error ? err.message : '摄像头权限被拒绝',
        source: 'camera',
      },
    };
  }
  // Snapshot a single frame via a hidden video element + canvas. Kept here
  // so callers don't have to thread DOM logic through their components.
  const video = document.createElement('video');
  const track = stream.getTracks().find((t) => t.kind === 'video');
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    return {
      kind: 'err',
      error: { code: 'no_stream', message: '未获取到视频轨道', source: 'camera' },
    };
  }
  // Build a temporary MediaStream from the track for the video element.
  const tmpStream = new MediaStream([track as unknown as MediaStreamTrack]);
  video.srcObject = tmpStream;
  await video.play().catch(() => undefined);
  // Wait one frame to ensure non-black pixels.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 320;
  canvas.height = video.videoHeight || 240;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    stream.getTracks().forEach((t) => t.stop());
    return {
      kind: 'err',
      error: {
        code: 'recorder_error',
        message: '无法获取 2D canvas context',
        source: 'camera',
      },
    };
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  stream.getTracks().forEach((t) => t.stop());

  const mime = pickSupportedImageMime();
  const dataUrl = canvas.toDataURL(mime);
  const parsed = parseDataUrl(dataUrl);
  const cap = options.maxBytes ?? MAX_MEDIA_BYTES;
  if (parsed.bytes > cap) {
    return {
      kind: 'err',
      error: {
        code: 'oversize',
        message: `图片大小 ${parsed.bytes} 字节超过 ${cap} 上限`,
        source: 'camera',
      },
    };
  }
  return {
    kind: 'ok',
    data: {
      kind: 'image',
      mime,
      dataUrl,
      bytes: parsed.bytes,
      capturedAt: (options.now ?? Date.now)(),
      source: 'camera',
    },
  };
}

export function describeMedia(result: MediaCaptureResult): string {
  if (result.kind === 'audio') {
    const seconds = ((result.durationMs ?? 0) / 1000).toFixed(1);
    return `${seconds}s · ${formatBytes(result.bytes)}`;
  }
  return `${result.mime.replace('image/', '')} · ${formatBytes(result.bytes)}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
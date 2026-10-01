// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { ComposerMediaControls } from './ComposerMediaControls';
import { captureImage, type MediaCaptureResult } from './composer-media';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  (globalThis as { FileReader?: unknown }).FileReader = class {
    result: string | null = null;
    error: Error | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: { size: number; type: string }) {
      this.result = `data:${blob.type};base64,${'A'.repeat(blob.size)}`;
      this.onload?.();
    }
  };
});

function Harness({ onCapture }: { onCapture: (r: MediaCaptureResult) => void }) {
  const [busy, setBusy] = useState<null | 'mic' | 'camera'>(null);
  return (
    <ComposerMediaControls
      disabled={false}
      isCapturing={busy}
      onCameraStart={() => setBusy('camera')}
      onCameraStop={() => setBusy(null)}
      onMicStart={() => setBusy('mic')}
      onMicStop={() => setBusy(null)}
      onError={(err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        setBusy(null);
      }}
      onCapture={onCapture}
    />
  );
}

describe('ComposerMediaControls', () => {
  it('renders mic and camera buttons', () => {
    const { getByLabelText } = render(<Harness onCapture={() => {}} />);
    expect(getByLabelText('录制语音')).toBeTruthy();
    expect(getByLabelText('拍照')).toBeTruthy();
  });

  it('disables both buttons when disabled=true', () => {
    function Static() {
      return (
        <ComposerMediaControls
          disabled
          isCapturing={null}
          onCameraStart={() => {}}
          onCameraStop={() => {}}
          onMicStart={() => {}}
          onMicStop={() => {}}
          onError={() => {}}
          onCapture={() => {}}
        />
      );
    }
    const { getByLabelText } = render(<Static />);
    expect((getByLabelText('录制语音') as HTMLButtonElement).disabled).toBe(true);
    expect((getByLabelText('拍照') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows busy state and invokes stop when capturing', () => {
    let cameraStop = vi.fn();
    function Busy() {
      return (
        <ComposerMediaControls
          disabled={false}
          isCapturing="camera"
          onCameraStart={() => {}}
          onCameraStop={cameraStop}
          onMicStart={() => {}}
          onMicStop={() => {}}
          onError={() => {}}
          onCapture={() => {}}
        />
      );
    }
    const { getByLabelText } = render(<Busy />);
    const camBtn = getByLabelText('停止拍照') as HTMLButtonElement;
    expect(camBtn).toBeTruthy();
    fireEvent.click(camBtn);
    expect(cameraStop).toHaveBeenCalled();
  });

  it('invokes captureImage handler when camera start is clicked and resolves', async () => {
    const onCapture = vi.fn();
    vi.spyOn({ captureImage }, 'captureImage').mockImplementation?.(() => Promise.resolve({} as never));
    // Stub captureImage via globalThis module override: simpler — provide a fake getUserMedia
    (globalThis as { navigator?: unknown }).navigator = {
      mediaDevices: {
        getUserMedia: () =>
          Promise.reject(new Error('denied')),
      },
    };
    function Wrapper() {
      return (
        <ComposerMediaControls
          disabled={false}
          isCapturing={null}
          onCameraStart={() => {}}
          onCameraStop={() => {}}
          onMicStart={() => {}}
          onMicStop={() => {}}
          onError={() => {}}
          onCapture={onCapture}
        />
      );
    }
    const { getByLabelText } = render(<Wrapper />);
    fireEvent.click(getByLabelText('拍照'));
    // Even on error, no capture should fire.
    await new Promise((r) => setTimeout(r, 10));
    expect(onCapture).not.toHaveBeenCalled();
  });
});
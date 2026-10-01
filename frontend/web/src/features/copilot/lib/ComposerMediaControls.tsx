import { Mic, MicOff, Camera, CameraOff } from 'lucide-react';
import {
  captureAudio,
  captureImage,
  type MediaCaptureError,
  type MediaCaptureResult,
} from './composer-media';

export type ComposerMediaControlsProps = {
  disabled: boolean;
  isCapturing: null | 'mic' | 'camera';
  onCameraStart: () => void;
  onCameraStop: () => void;
  onMicStart: () => void;
  onMicStop: () => void;
  onError: (err: MediaCaptureError) => void;
  onCapture: (result: MediaCaptureResult) => void;
  micLabel?: string;
  cameraLabel?: string;
  className?: string;
};

export function ComposerMediaControls({
  disabled,
  isCapturing,
  onCameraStart,
  onCameraStop,
  onMicStart,
  onMicStop,
  onError,
  onCapture,
  micLabel = '录制语音',
  cameraLabel = '拍照',
  className,
}: ComposerMediaControlsProps): JSX.Element {
  const handleMic = async () => {
    if (disabled) return;
    if (isCapturing === 'mic') {
      onMicStop();
      return;
    }
    onMicStart();
    const result = await captureAudio();
    if (result.kind === 'err') {
      onError(result.error);
      onMicStop();
      return;
    }
    onCapture(result.data);
    onMicStop();
  };

  const handleCamera = async () => {
    if (disabled) return;
    if (isCapturing === 'camera') {
      onCameraStop();
      return;
    }
    onCameraStart();
    const result = await captureImage();
    if (result.kind === 'err') {
      onError(result.error);
      onCameraStop();
      return;
    }
    onCapture(result.data);
    onCameraStop();
  };

  return (
    <span
      data-testid="composer-media-controls"
      className={
        className ??
        'inline-flex items-center gap-1'
      }
    >
      <button
        type="button"
        aria-label={isCapturing === 'mic' ? '停止录音' : micLabel}
        onClick={handleMic}
        disabled={disabled}
        data-testid="composer-mic-button"
        data-capturing={isCapturing === 'mic' ? 'true' : 'false'}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-50"
      >
        {isCapturing === 'mic' ? (
          <MicOff className="h-4 w-4 text-rose-500" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </button>
      <button
        type="button"
        aria-label={isCapturing === 'camera' ? '停止拍照' : cameraLabel}
        onClick={handleCamera}
        disabled={disabled}
        data-testid="composer-camera-button"
        data-capturing={isCapturing === 'camera' ? 'true' : 'false'}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-50"
      >
        {isCapturing === 'camera' ? (
          <CameraOff className="h-4 w-4 text-rose-500" />
        ) : (
          <Camera className="h-4 w-4" />
        )}
      </button>
    </span>
  );
}

export default ComposerMediaControls;
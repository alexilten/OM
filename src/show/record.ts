/**
 * Clip recording (Round 09): the viewport canvas and the show's master mix into one file with
 * MediaRecorder. WebM (VP9/VP8 + Opus) where supported, MP4 on Safari. The clip stays in the browser.
 */

const TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
export const MAX_CLIP_SECONDS = 30;

export const recordingSupported = () => typeof MediaRecorder !== 'undefined' && TYPES.some((t) => MediaRecorder.isTypeSupported(t));

export interface Recording {
  stop: () => void;
}

export function startRecording(canvas: HTMLCanvasElement, audio: MediaStream | null, onDone: (blob: Blob, ext: string, seconds: number) => void, fps = 30): Recording {
  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t))!;
  const stream = canvas.captureStream(fps);
  audio?.getAudioTracks().forEach((t) => stream.addTrack(t));
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  const started = performance.now();
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    stream.getVideoTracks().forEach((t) => t.stop());
    onDone(new Blob(chunks, { type: mimeType.split(';')[0] }), mimeType.includes('mp4') ? 'mp4' : 'webm', (performance.now() - started) / 1000);
  };
  rec.start(500);
  const timer = setTimeout(() => rec.state !== 'inactive' && rec.stop(), MAX_CLIP_SECONDS * 1000);
  return {
    stop: () => {
      clearTimeout(timer);
      if (rec.state !== 'inactive') rec.stop();
    },
  };
}

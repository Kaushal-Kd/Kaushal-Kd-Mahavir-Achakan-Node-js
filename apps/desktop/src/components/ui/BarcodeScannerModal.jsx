import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { Camera, RotateCw, Upload } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useRef, useState } from 'react';

import Button from './Button.jsx';
import Modal from './Modal.jsx';

const BUILD_HINTS = () => {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.CODE_93,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.DATA_MATRIX,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
};

const MIN_CODE_LENGTH = 3;
const SCAN_INTERVAL_MS = 45;
const CONTINUOUS_COOLDOWN_MS = 450;

const isPlausibleCode = (text) => {
  if (!text) return false;
  const trimmed = String(text).trim();
  if (trimmed.length < MIN_CODE_LENGTH) return false;
  return /[A-Za-z0-9]/.test(trimmed);
};

function neededHits(text) {
  return String(text || '').trim().length >= 4 ? 1 : 2;
}

function stopStream(stream) {
  stream?.getTracks?.().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* noop */
    }
  });
}

async function applyLiveFocus(track) {
  if (!track?.applyConstraints) return;
  try {
    await track.applyConstraints({
      advanced: [{ focusMode: 'continuous' }],
    });
  } catch {
    /* not all cameras support focusMode */
  }
}

function tryDecodeCanvas(reader, canvas) {
  try {
    return reader.decodeFromCanvas(canvas) || null;
  } catch {
    return null;
  }
}

/**
 * Live camera barcode / QR scanner.
 * Starts the camera once, decodes the viewfinder crop, and accepts a product
 * code on the first solid read so search/scan screens lock in faster.
 */
const BarcodeScannerModal = ({
  isOpen,
  onClose,
  onDetected,
  title = 'Scan Barcode',
  continuousScan = false,
}) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const readerRef = useRef(null);
  const canvasRef = useRef(null);
  const pendingRef = useRef({ text: '', hits: 0 });
  const acceptedRef = useRef(false);
  const lastAcceptRef = useRef({ text: '', ts: 0 });
  const onDetectedRef = useRef(onDetected);
  const selectedDeviceRef = useRef('');
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [cameraEpoch, setCameraEpoch] = useState(0);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [lastHit, setLastHit] = useState('');
  const [decoding, setDecoding] = useState(false);

  const hints = useMemo(() => BUILD_HINTS(), []);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      selectedDeviceRef.current = '';
      setDeviceId('');
      setDevices([]);
      setLastHit('');
      setError('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    let scanTimer = 0;
    let waitFrame = 0;

    const fireDetected = (text) => {
      onDetectedRef.current?.(text);
    };

    const acceptCode = (text) => {
      if (continuousScan) {
        const now = Date.now();
        if (text === lastAcceptRef.current.text && now - lastAcceptRef.current.ts < CONTINUOUS_COOLDOWN_MS) {
          pendingRef.current = { text: '', hits: 0 };
          return;
        }
        lastAcceptRef.current = { text, ts: now };
        acceptedRef.current = true;
        setLastHit(text);
        fireDetected(text);
        window.setTimeout(() => {
          if (!cancelled) {
            acceptedRef.current = false;
            pendingRef.current = { text: '', hits: 0 };
            setLastHit('');
          }
        }, CONTINUOUS_COOLDOWN_MS);
        return;
      }

      acceptedRef.current = true;
      setLastHit(text);
      fireDetected(text);
    };

    const handleDecodedText = (raw) => {
      if (cancelled || acceptedRef.current) return;
      const text = String(raw || '').trim();
      if (!isPlausibleCode(text)) {
        pendingRef.current = { text: '', hits: 0 };
        return;
      }
      if (pendingRef.current.text === text) pendingRef.current.hits += 1;
      else pendingRef.current = { text, hits: 1 };
      if (pendingRef.current.hits < neededHits(text)) return;
      acceptCode(text);
    };

    const scanCrop = (video) => {
      if (cancelled || acceptedRef.current) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw < 80 || vh < 80) return;
      const cropW = Math.max(80, Math.round(vw * 0.9));
      const cropH = Math.max(48, Math.round(vh * 0.38));
      const sx = Math.round((vw - cropW) / 2);
      const sy = Math.round((vh - cropH) / 2);
      let canvas = canvasRef.current;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvasRef.current = canvas;
      }
      if (canvas.width !== cropW) canvas.width = cropW;
      if (canvas.height !== cropH) canvas.height = cropH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
      const result = tryDecodeCanvas(readerRef.current, canvas);
      if (result) handleDecodedText(result.getText?.() || '');
    };

    const loop = (video) => {
      if (cancelled) return;
      if (!acceptedRef.current) scanCrop(video);
      scanTimer = window.setTimeout(() => loop(video), SCAN_INTERVAL_MS);
    };

    const start = async () => {
      const video = videoRef.current;
      if (!video) {
        waitFrame = window.requestAnimationFrame(() => {
          if (!cancelled) start();
        });
        return;
      }

      setStarting(true);
      setError('');
      setLastHit('');
      pendingRef.current = { text: '', hits: 0 };
      acceptedRef.current = false;
      lastAcceptRef.current = { text: '', ts: 0 };

      const preferredId = selectedDeviceRef.current;
      const videoConstraints = preferredId
        ? {
            deviceId: { exact: preferredId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          }
        : {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          };

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
        if (cancelled) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        await applyLiveFocus(track);
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play().catch(() => {});
        if (cancelled) return;

        const liveId = track?.getSettings?.().deviceId || preferredId || '';
        if (liveId) {
          selectedDeviceRef.current = liveId;
          setDeviceId(liveId);
        }

        try {
          const list = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled) {
            setDevices(list.filter((d) => d.kind === 'videoinput'));
          }
        } catch {
          /* labels may stay empty until permission, scanning still works */
        }

        readerRef.current = new BrowserMultiFormatReader(hints);
        setStarting(false);
        loop(video);
      } catch (e) {
        if (cancelled) return;
        setStarting(false);
        setError(
          e?.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow the camera permission in your browser / system settings and try again.'
            : e?.message || 'Unable to access camera.'
        );
      }
    };

    start();

    return () => {
      cancelled = true;
      window.clearTimeout(scanTimer);
      window.cancelAnimationFrame(waitFrame);
      try {
        stopStream(streamRef.current);
      } catch {
        /* noop */
      }
      streamRef.current = null;
      readerRef.current = null;
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
  }, [isOpen, cameraEpoch, hints, continuousScan]);

  useEffect(() => {
    if (isOpen) return;
    try {
      stopStream(streamRef.current);
    } catch {
      /* noop */
    }
    streamRef.current = null;
    const video = videoRef.current;
    if (video?.srcObject) {
      stopStream(video.srcObject);
      video.srcObject = null;
    }
  }, [isOpen]);

  const switchToDevice = (nextId) => {
    const id = String(nextId || '').trim();
    if (!id || id === selectedDeviceRef.current || id === deviceId) return;
    selectedDeviceRef.current = id;
    setDeviceId(id);
    setCameraEpoch((n) => n + 1);
  };

  const handleFileSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose a valid image file.');
      return;
    }
    setError('');
    setDecoding(true);
    const objectUrl = URL.createObjectURL(file);
    try {
      const reader = new BrowserMultiFormatReader(hints);
      const result = await reader.decodeFromImageUrl(objectUrl);
      const text = String(result?.getText?.() || '').trim();
      if (!isPlausibleCode(text)) {
        setError('Could not read a valid barcode in that image. Try a clearer, closer photo.');
        return;
      }
      if (continuousScan) {
        const now = Date.now();
        if (text === lastAcceptRef.current.text && now - lastAcceptRef.current.ts < CONTINUOUS_COOLDOWN_MS) {
          return;
        }
        lastAcceptRef.current = { text, ts: now };
        setLastHit(text);
        onDetectedRef.current?.(text);
        window.setTimeout(() => setLastHit(''), CONTINUOUS_COOLDOWN_MS);
        return;
      }
      setLastHit(text);
      onDetectedRef.current?.(text);
    } catch (e) {
      setError(
        e?.message?.includes('NotFoundException') || e?.name === 'NotFoundException'
          ? 'No barcode detected in that image.'
          : e?.message || 'Failed to decode the uploaded image.'
      );
    } finally {
      URL.revokeObjectURL(objectUrl);
      setDecoding(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title={title || 'Scan Barcode'}
      footer={
        <>
          <Button
            variant="secondary"
            icon={Upload}
            iconPosition="left"
            disabled={decoding}
            onClick={() => fileInputRef.current?.click()}
          >
            {decoding ? 'Decoding…' : 'Upload image'}
          </Button>
          {devices.length > 1 ? (
            <Button
              variant="secondary"
              icon={RotateCw}
              iconPosition="left"
              onClick={() => {
                const idx = devices.findIndex((d) => d.deviceId === deviceId);
                const next = devices[(idx + 1) % devices.length];
                if (next) switchToDevice(next.deviceId);
              }}
            >
              Switch camera
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            {continuousScan ? 'Done' : 'Cancel'}
          </Button>
        </>
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelected}
      />
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm mb-3">
          {error}
        </div>
      ) : null}

      <div className="relative rounded-md overflow-hidden bg-black aspect-[4/3]">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          muted
          autoPlay
          playsInline
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative w-[90%] h-[38%] border-0">
            <CornerBrackets />
            <div className="absolute inset-x-0 top-1/2 h-[2px] bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.7)] animate-pulse" />
          </div>
        </div>
        {starting ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-sm">
            <Camera size={16} className="mr-2" /> Starting camera…
          </div>
        ) : null}
        {lastHit ? (
          <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/30 backdrop-blur-[1px] transition-opacity">
            <div className="px-3 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium shadow-lg">
              Scanned: {lastHit}
            </div>
          </div>
        ) : null}
        {decoding ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-sm">
            <Upload size={16} className="mr-2 animate-pulse" /> Decoding image…
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
        <span>
          {continuousScan
            ? 'Hold the barcode on the red line — next item can scan right away.'
            : 'Hold the barcode on the red line. Closer is faster.'}
        </span>
        {devices.length > 0 ? (
          <select
            value={deviceId}
            onChange={(e) => switchToDevice(e.target.value)}
            className="input h-8 text-xs max-w-[55%]"
          >
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </Modal>
  );
};

const CornerBrackets = () => {
  const base = 'absolute w-8 h-8 border-white/90';
  return (
    <>
      <span className={`${base} top-0 left-0 border-t-4 border-l-4 rounded-tl-sm`} />
      <span className={`${base} top-0 right-0 border-t-4 border-r-4 rounded-tr-sm`} />
      <span className={`${base} bottom-0 left-0 border-b-4 border-l-4 rounded-bl-sm`} />
      <span className={`${base} bottom-0 right-0 border-b-4 border-r-4 rounded-br-sm`} />
    </>
  );
};

BarcodeScannerModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onDetected: PropTypes.func.isRequired,
  title: PropTypes.string,
  continuousScan: PropTypes.bool,
};

export default BarcodeScannerModal;

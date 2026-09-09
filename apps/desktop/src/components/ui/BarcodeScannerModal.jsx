import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { Camera, RotateCw, Upload } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useRef, useState } from 'react';

import Button from './Button.jsx';
import Modal from './Modal.jsx';

// Prioritising CODE128 (our product codes) + the rest of the common 1D/2D
// formats and turning on TRY_HARDER dramatically improves decode reliability
// from webcams where the barcode fills only a small portion of the frame.
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

// CODE128 encodes control characters (FNC1..4, shift codes, etc.) and ZXing
// can briefly emit a spurious 1-2 character result before it locks on to the
// real label. We therefore:
//  - require the decoded text to look like a plausible product code
//    (at least 3 printable chars, no control chars)
//  - accept it only after the same value is seen on two consecutive frames.
const MIN_CODE_LENGTH = 3;
const isPlausibleCode = (text) => {
  if (!text) return false;
  const trimmed = String(text).trim();
  if (trimmed.length < MIN_CODE_LENGTH) return false;
  // Reject strings that are only punctuation / control chars.
  return /[A-Za-z0-9]/.test(trimmed);
};

/**
 * Live camera barcode / QR scanner.
 *
 * Uses @zxing/browser which supports CODE128 (our product code format) as well
 * as QR, EAN, UPC, etc. The video stream and the ZXing controls are torn down
 * when the modal closes so the camera light goes off immediately.
 */
const BarcodeScannerModal = ({
  isOpen,
  onClose,
  onDetected,
  title = 'Scan Barcode',
  continuousScan = false,
}) => {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const readerRef = useRef(null);
  // Tracks the candidate decoded value and how many consecutive frames have
  // confirmed it, so a transient misread (e.g. a lone "+" from CODE128 control
  // codes) doesn't get accepted.
  const pendingRef = useRef({ text: '', hits: 0 });
  const acceptedRef = useRef(false);
  /** In continuous mode, suppress duplicate fires while the same label stays in frame. */
  const lastAcceptRef = useRef({ text: '', ts: 0 });
  // Keep the latest callbacks in refs so the reader effect isn't restarted on
  // every parent render (which would flash the camera stream).
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [lastHit, setLastHit] = useState('');
  const [decoding, setDecoding] = useState(false);

  const hints = useMemo(() => BUILD_HINTS(), []);
  const fileInputRef = useRef(null);

  // Enumerate available cameras when the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    (async () => {
      setError('');
      try {
        // Prompt permission so labels are populated.
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((t) => t.stop());
        const list = await navigator.mediaDevices.enumerateDevices();
        if (!alive) return;
        const cams = list.filter((d) => d.kind === 'videoinput');
        setDevices(cams);
        // Prefer the back camera when available.
        const back = cams.find((d) => /back|rear|environment/i.test(d.label));
        setDeviceId((prev) => prev || back?.deviceId || cams[0]?.deviceId || '');
      } catch (e) {
        setError(
          e?.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow the camera permission in your browser / system settings and try again.'
            : e?.message || 'Unable to access camera.'
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [isOpen]);

  // Start / restart the ZXing reader whenever the selected device changes.
  useEffect(() => {
    if (!isOpen || !deviceId || !videoRef.current) return undefined;
    let cancelled = false;
    setStarting(true);
    setError('');
    setLastHit('');
    pendingRef.current = { text: '', hits: 0 };
    acceptedRef.current = false;
    lastAcceptRef.current = { text: '', ts: 0 };
    // High-res + TRY_HARDER hints make CODE128 decoding much more reliable on
    // laptop webcams, which are the primary scanning device here.
    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 80,
      delayBetweenScanSuccess: 300,
    });
    readerRef.current = reader;
    const constraints = {
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    };
    reader
      .decodeFromConstraints(constraints, videoRef.current, (result, _err, controls) => {
        if (cancelled || acceptedRef.current) return;
        controlsRef.current = controls;
        setStarting(false);
        if (!result) return;
        const raw = result.getText();
        const text = String(raw || '').trim();
        // Discard implausible results (control chars, 1-2 character glitches).
        if (!isPlausibleCode(text)) {
          pendingRef.current = { text: '', hits: 0 };
          return;
        }
        // Require two consecutive frames to agree before accepting, so a
        // one-off partial decode doesn't fire a bogus API call.
        if (pendingRef.current.text === text) {
          pendingRef.current.hits += 1;
        } else {
          pendingRef.current = { text, hits: 1 };
        }
        if (pendingRef.current.hits < 2) return;

        if (continuousScan) {
          const now = Date.now();
          if (text === lastAcceptRef.current.text && now - lastAcceptRef.current.ts < 900) {
            pendingRef.current = { text: '', hits: 0 };
            return;
          }
          lastAcceptRef.current = { text, ts: now };
          acceptedRef.current = true;
          setLastHit(text);
          window.setTimeout(() => {
            if (!cancelled) onDetectedRef.current?.(text);
          }, 140);
          window.setTimeout(() => {
            if (!cancelled) {
              acceptedRef.current = false;
              pendingRef.current = { text: '', hits: 0 };
              setLastHit('');
            }
          }, 700);
          return;
        }

        acceptedRef.current = true;
        setLastHit(text);
        try {
          controls?.stop();
        } catch {
          /* noop */
        }
        // Slight delay so the user sees the green flash before the modal
        // closes and the product details populate on the page.
        window.setTimeout(() => {
          if (!cancelled) onDetectedRef.current?.(text);
        }, 140);
      })
      .catch((e) => {
        if (cancelled) return;
        setStarting(false);
        setError(e?.message || 'Failed to start scanner.');
      });

    return () => {
      cancelled = true;
      try {
        controlsRef.current?.stop();
      } catch {
        /* noop */
      }
      controlsRef.current = null;
      readerRef.current = null;
    };
  }, [isOpen, deviceId, hints, continuousScan]);

  // When the modal is fully closed, make sure the tracks are released.
  useEffect(() => {
    if (isOpen) return;
    try {
      controlsRef.current?.stop();
    } catch {
      /* noop */
    }
    controlsRef.current = null;
    const video = videoRef.current;
    if (video?.srcObject) {
      const stream = video.srcObject;
      stream.getTracks?.().forEach((t) => t.stop());
      video.srcObject = null;
    }
  }, [isOpen]);

  // Decode a barcode from an uploaded image file. Works offline and is a great
  // fallback when the webcam focus / resolution is too low to read the label.
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
      const raw = result?.getText?.() || '';
      const text = String(raw).trim();
      if (!isPlausibleCode(text)) {
        setError('Could not read a valid barcode in that image. Try a clearer, closer photo.');
        return;
      }
      if (continuousScan) {
        const now = Date.now();
        if (text === lastAcceptRef.current.text && now - lastAcceptRef.current.ts < 900) {
          setDecoding(false);
          return;
        }
        lastAcceptRef.current = { text, ts: now };
        acceptedRef.current = true;
        setLastHit(text);
        window.setTimeout(() => {
          onDetectedRef.current?.(text);
        }, 140);
        window.setTimeout(() => {
          acceptedRef.current = false;
          setLastHit('');
        }, 700);
        setDecoding(false);
        return;
      }

      acceptedRef.current = true;
      setLastHit(text);
      try {
        controlsRef.current?.stop();
      } catch {
        /* noop */
      }
      window.setTimeout(() => {
        onDetectedRef.current?.(text);
      }, 140);
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
                if (next) setDeviceId(next.deviceId);
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
        {/* Targeting frame overlay */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative w-4/5 h-1/2 border-0">
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
            ? 'Scan one item after another — close when finished.'
            : 'Align the barcode within the frame — or use Upload image.'}
        </span>
        {devices.length > 0 ? (
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
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
  const base =
    'absolute w-8 h-8 border-white/90';
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
  /** When true, each successful decode calls onDetected and keeps the camera running until the user closes the modal. */
  continuousScan: PropTypes.bool,
};


export default BarcodeScannerModal;

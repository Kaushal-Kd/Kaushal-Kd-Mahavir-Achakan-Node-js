import { Camera, RotateCw } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useRef, useState } from 'react';

import Button from './Button.jsx';
import Modal from './Modal.jsx';

const CameraCaptureModal = ({ isOpen, onClose, onCapture, title = 'Capture image' }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    (async () => {
      setError('');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((t) => t.stop());
        const list = await navigator.mediaDevices.enumerateDevices();
        if (!alive) return;
        const cams = list.filter((d) => d.kind === 'videoinput');
        setDevices(cams);
        const back = cams.find((d) => /back|rear|environment/i.test(d.label));
        setDeviceId(back?.deviceId || cams[0]?.deviceId || '');
      } catch (e) {
        setError(
          e?.name === 'NotAllowedError'
            ? 'Camera permission was blocked. Allow camera access and try again.'
            : e?.message || 'Unable to access camera.'
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !deviceId || !videoRef.current) return;
    let cancelled = false;
    (async () => {
      setStarting(true);
      setError('');
      stopStream();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Failed to start camera.');
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, deviceId]);

  useEffect(() => {
    if (isOpen) return;
    stopStream();
  }, [isOpen]);

  const capture = async () => {
    const video = videoRef.current;
    if (!video) return;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    if (!width || !height) {
      setError('Camera not ready. Please wait a moment.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError('Could not capture image.');
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) {
      setError('Could not capture image.');
      return;
    }
    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
    onCapture(file);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title={title}
      footer={
        <>
          {devices.length > 1 ? (
            <Button
              type="button"
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
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" icon={Camera} iconPosition="left" onClick={capture}>
            Capture
          </Button>
        </>
      }
    >
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm mb-3">
          {error}
        </div>
      ) : null}
      <div className="relative rounded-md overflow-hidden bg-black aspect-[4/3]">
        <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
        {starting ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-sm">
            <Camera size={16} className="mr-2" /> Starting camera...
          </div>
        ) : null}
      </div>
    </Modal>
  );
};

CameraCaptureModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCapture: PropTypes.func.isRequired,
  title: PropTypes.string,
};

export default CameraCaptureModal;

import { RotateCcw, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactCrop, {
  centerCrop,
  convertToPixelCrop,
  makeAspectCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

import { useIsMobileNav } from '../../hooks/useBreakpoint.js';
import { useUIStore, toast } from '../../stores/uiStore.js';
import {
  blobToImageFile,
  getCroppedImageBlob,
  getRotatedImageBlob,
} from '../../utils/cropImage.js';

import Button from './Button.jsx';
import Modal from './Modal.jsx';

/** @param {number} mediaWidth @param {number} mediaHeight @param {number|undefined} aspect */
function buildInitialCrop(mediaWidth, mediaHeight, aspect) {
  if (aspect) {
    return centerCrop(
      makeAspectCrop({ unit: '%', width: 88 }, aspect, mediaWidth, mediaHeight),
      mediaWidth,
      mediaHeight
    );
  }
  return centerCrop(
    { unit: '%', width: 88, height: 88 },
    mediaWidth,
    mediaHeight
  );
}

/**
 * @param {import('react-image-crop').Crop} crop
 * @param {HTMLImageElement} img
 */
function cropToNaturalPixels(crop, img) {
  const displayW = img.width;
  const displayH = img.height;
  const pixelCrop =
    crop.unit === '%'
      ? convertToPixelCrop(crop, displayW, displayH)
      : { ...crop, unit: 'px' };
  const scaleX = img.naturalWidth / displayW;
  const scaleY = img.naturalHeight / displayH;
  return {
    x: Math.round(pixelCrop.x * scaleX),
    y: Math.round(pixelCrop.y * scaleY),
    width: Math.round(pixelCrop.width * scaleX),
    height: Math.round(pixelCrop.height * scaleY),
  };
}

const ImageCropModal = () => {
  const session = useUIStore((s) => s.imageCropSession);
  const finishImageCrop = useUIStore((s) => s.finishImageCrop);
  const cancelImageCrop = useUIStore((s) => s.cancelImageCrop);
  const isMobile = useIsMobileNav();
  const modalSize = isMobile ? 'full' : '2xl';

  const imgRef = useRef(null);
  const previewUrlRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [crop, setCrop] = useState();
  const [completedCrop, setCompletedCrop] = useState();
  const [rotation, setRotation] = useState(0);
  const [rotating, setRotating] = useState(false);
  const [applying, setApplying] = useState(false);

  const revokePreviewUrl = useCallback((url) => {
    if (url && url !== session?.objectUrl) {
      URL.revokeObjectURL(url);
    }
  }, [session?.objectUrl]);

  const buildPreview = useCallback(
    async (deg) => {
      if (!session?.objectUrl) return session?.objectUrl || null;
      const normalized = ((Math.round(deg) % 360) + 360) % 360;
      if (normalized === 0) return session.objectUrl;
      const blob = await getRotatedImageBlob(
        session.objectUrl,
        normalized,
        session.file?.type || 'image/jpeg'
      );
      return URL.createObjectURL(blob);
    },
    [session?.objectUrl, session?.file?.type]
  );

  useEffect(() => {
    if (!session) {
      revokePreviewUrl(previewUrlRef.current);
      previewUrlRef.current = null;
      setPreviewUrl(null);
      setCrop(undefined);
      setCompletedCrop(undefined);
      setRotation(0);
      setRotating(false);
      setApplying(false);
      return;
    }

    previewUrlRef.current = session.objectUrl;
    setPreviewUrl(session.objectUrl);
    setCrop(undefined);
    setCompletedCrop(undefined);
    setRotation(0);
    setRotating(false);
    setApplying(false);
  }, [session?.objectUrl, revokePreviewUrl]);

  useEffect(
    () => () => {
      revokePreviewUrl(previewUrlRef.current);
    },
    [revokePreviewUrl]
  );

  const onImageLoad = useCallback(
    (e) => {
      const { width, height } = e.currentTarget;
      if (!width || !height) return;
      const initial = buildInitialCrop(width, height, session?.aspect);
      setCrop(initial);
      setCompletedCrop(undefined);
    },
    [session?.aspect]
  );

  const handleClose = () => {
    if (applying || rotating) return;
    cancelImageCrop();
  };

  const handleRotate = async (delta) => {
    if (!session?.objectUrl || rotating || applying) return;
    const nextRotation = rotation + delta;
    setRotating(true);
    setCrop(undefined);
    setCompletedCrop(undefined);
    try {
      const nextUrl = await buildPreview(nextRotation);
      revokePreviewUrl(previewUrlRef.current);
      previewUrlRef.current = nextUrl;
      setPreviewUrl(nextUrl);
      setRotation(nextRotation);
    } catch (err) {
      toast.error(err?.message || 'Could not rotate image');
    } finally {
      setRotating(false);
    }
  };

  const handleApply = async () => {
    if (!session?.file || !previewUrl || applying || rotating) return;
    const img = imgRef.current;
    if (!img || !crop?.width || !crop?.height) {
      toast.warning('Adjust the crop area first');
      return;
    }

    const pixels = cropToNaturalPixels(completedCrop || crop, img);
    if (!pixels.width || !pixels.height) {
      toast.warning('Adjust the crop area first');
      return;
    }

    setApplying(true);
    try {
      const blob = await getCroppedImageBlob({
        imageSrc: previewUrl,
        cropPixels: pixels,
        mimeType: session.file.type || 'image/jpeg',
      });
      const croppedFile = blobToImageFile(blob, session.file);
      finishImageCrop(croppedFile);
    } catch (err) {
      toast.error(err?.message || 'Could not crop image');
      setApplying(false);
    }
  };

  const rotationLabel =
    rotation === 0
      ? null
      : `${((rotation % 360) + 360) % 360}°`;

  return (
    <Modal
      isOpen={!!session}
      onClose={handleClose}
      title={session?.title || 'Crop image'}
      size={modalSize}
      footer={
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={applying || rotating}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply} loading={applying} disabled={rotating}>
            Apply
          </Button>
        </div>
      }
    >
      {session && previewUrl ? (
        <div className="space-y-4">
          <div className="image-crop-stage relative w-full min-h-[28rem] h-[min(72vh,40rem)] max-h-[calc(100dvh-11rem)] flex items-center justify-center bg-gray-100 rounded-md overflow-hidden">
            {rotating ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 text-sm text-gray-600">
                Rotating…
              </div>
            ) : null}
            <ReactCrop
              crop={crop}
              onChange={(_, percentCrop) => setCrop(percentCrop)}
              onComplete={(pixelCrop) => setCompletedCrop(pixelCrop)}
              aspect={session.aspect}
              circularCrop={session.aspect === 1}
              keepSelection
              className="max-h-full max-w-full"
            >
              <img
                key={previewUrl}
                ref={imgRef}
                src={previewUrl}
                alt=""
                onLoad={onImageLoad}
                className="block max-h-[min(68vh,38rem)] max-w-full w-auto h-auto"
                style={{ maxHeight: 'min(68vh, 38rem)' }}
              />
            </ReactCrop>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-600">
              Rotate{rotationLabel ? ` (${rotationLabel})` : ''}
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon={RotateCcw}
              onClick={() => handleRotate(-90)}
              disabled={rotating || applying}
            >
              Left
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon={RotateCw}
              onClick={() => handleRotate(90)}
              disabled={rotating || applying}
            >
              Right
            </Button>
          </div>

          <p className="text-[11px] text-gray-500 leading-snug">
            Drag the crop frame or pull its corners and edges to resize. Rotate updates the preview;
            crop matches what you see on screen.
          </p>
        </div>
      ) : null}
    </Modal>
  );
};

export default ImageCropModal;

import { Camera, ImageUp } from 'lucide-react';
import PropTypes from 'prop-types';
import { useRef, useState } from 'react';

import Button from '../ui/Button.jsx';
import CameraCaptureModal from '../ui/CameraCaptureModal.jsx';
import { accessoriesApi } from '../../lib/api/accessories.js';
import { toast } from '../../stores/uiStore.js';

const MAX_SIDE = 640;

/** Shrink a photo in the browser before upload (faster scans, smaller payload). */
async function fileToScanDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * "Scan" control for accessory pickers: capture or upload a photo and get
 * look-alike accessories from the shop's own catalog (matched on our server).
 */
const AccessoryScanButton = ({ categoryId = null, onResults, disabled = false }) => {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const runScan = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const image_data_url = await fileToScanDataUrl(file);
      const res = await accessoriesApi.visualSearch({
        image_data_url,
        ...(categoryId ? { category_id: categoryId } : {}),
        limit: 12,
      });
      const data = res?.data || {};
      const matches = Array.isArray(data.matches) ? data.matches : [];
      if (!matches.length) {
        toast.warning(
          data.indexed_count
            ? 'No similar accessory found. Try a closer photo on a plain background.'
            : 'Accessory photos are still being prepared for scanning. Try again in a few minutes.'
        );
      }
      onResults({ scanToken: data.scan_token || null, matches });
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Scan failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon={Camera}
          loading={busy}
          disabled={disabled || busy}
          onClick={() => setCameraOpen(true)}
          title="Scan an accessory with the camera to see look-alikes"
        >
          Scan
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          icon={ImageUp}
          iconOnly
          disabled={disabled || busy}
          onClick={() => fileRef.current?.click()}
          title="Upload a photo to find look-alike accessories"
          aria-label="Upload a photo to find look-alike accessories"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            void runScan(file);
          }}
        />
      </div>
      <CameraCaptureModal
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => {
          setCameraOpen(false);
          void runScan(file);
        }}
        title="Scan accessory (keep it centred on a plain background)"
      />
    </>
  );
};

AccessoryScanButton.propTypes = {
  /** Limit matches to one accessory category (e.g. MALA). */
  categoryId: PropTypes.string,
  /** Called with `{ scanToken, matches: [{ accessory_id, score }] }`. */
  onResults: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};

export default AccessoryScanButton;

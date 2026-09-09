import BulkUploadTab from '../settings/tabs/BulkUploadTab.jsx';

/** Bulk import lives under Inventory (not `/settings/...`). */
const InventoryBulkUpload = () => (
  <div className="min-h-0 lg:h-[calc(100vh-120px)] lg:overflow-hidden">
    <div className="min-h-0 min-w-0 overflow-x-auto lg:h-full lg:overflow-y-auto">
      <div className="w-full">
        <BulkUploadTab />
      </div>
    </div>
  </div>
);

export default InventoryBulkUpload;

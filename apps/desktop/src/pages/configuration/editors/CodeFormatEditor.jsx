import ProductCodeEditor from './ProductCodeEditor.jsx';
import AccessoryCodeEditor from './AccessoryCodeEditor.jsx';

/**
 * Single configuration page: shop-wide prefixes and padding for
 * auto-generated product and accessory codes.
 */
const CodeFormatEditor = () => (
  <div className="space-y-8">
    <ProductCodeEditor />
    <AccessoryCodeEditor />
  </div>
);

export default CodeFormatEditor;

import PropTypes from 'prop-types';

const AccessoryCodeHint = ({ categoryId, prefix, data, loading, error }) => {
  if (!categoryId || !prefix) return null;
  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-600" role="status">
      {loading ? 'Loading last accessory code...' : error ? (
        'Could not load the last code. You can still enter a code manually.'
      ) : (
        <>
          <span>Last / highest code for prefix {data?.prefix || prefix}: </span>
          <span className="font-mono font-semibold text-gray-900">{data?.code || 'None yet'}</span>
        </>
      )}
    </div>
  );
};

AccessoryCodeHint.propTypes = {
  categoryId: PropTypes.string,
  prefix: PropTypes.string,
  data: PropTypes.shape({ code: PropTypes.string, prefix: PropTypes.string }),
  loading: PropTypes.bool,
  error: PropTypes.bool,
};

export default AccessoryCodeHint;

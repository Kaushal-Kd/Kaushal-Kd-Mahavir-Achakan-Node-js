import PropTypes from 'prop-types';

import EmptyState from '../components/ui/EmptyState.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';

/**
 * Placeholder page used while a module is being built out.
 * The route/navigation is in place so the pattern (layout, breadcrumb,
 * permissions) is established and implementation just fills in the body.
 */
const PlaceholderPage = ({ title, description, icon, note }) => (
  <>
    <PageHeader title={title} description={description} />
    <div className="card p-12">
      <EmptyState
        icon={icon}
        title={`${title} module`}
        message={
          note ||
          'Module structure is ready. Add the data table, forms, and actions here following the pattern in Customers / Products.'
        }
      />
    </div>
  </>
);

PlaceholderPage.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  icon: PropTypes.elementType,
  note: PropTypes.string,
};

PlaceholderPage.defaultProps = { description: '', icon: null, note: '' };

export default PlaceholderPage;

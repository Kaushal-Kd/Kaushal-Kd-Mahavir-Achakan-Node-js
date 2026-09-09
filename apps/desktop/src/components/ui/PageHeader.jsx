import PropTypes from 'prop-types';
import { Link, useLocation } from 'react-router-dom';

const PageHeader = ({ title, description = '', breadcrumbs = null, actions = null }) => {
  const location = useLocation();
  const crumbs =
    breadcrumbs || buildBreadcrumbs(location.pathname).map((b) => ({ label: b.label, to: b.to }));

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4 sm:mb-5">
      <div className="min-w-0">
        {crumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="text-xs text-gray-500 mb-1 flex flex-wrap">
            {crumbs.map((c, i) => (
              <span key={i} className={i > 0 ? 'breadcrumb-sep' : ''}>
                {c.to && i < crumbs.length - 1 ? (
                  <Link to={c.to} className="hover:text-brand">
                    {c.label}
                  </Link>
                ) : (
                  <span className={i === crumbs.length - 1 ? 'text-gray-700 font-medium' : ''}>
                    {c.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="text-lg sm:text-xl font-semibold text-gray-900 break-words">{title}</h1>
        {description ? <p className="text-sm text-gray-500 mt-0.5">{description}</p> : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 overflow-x-auto pb-1 sm:pb-0 [&>*]:shrink-0">
          {actions}
        </div>
      ) : null}
    </div>
  );
};

function buildBreadcrumbs(path) {
  const parts = path.split('/').filter(Boolean);
  return [{ label: 'Dashboard', to: '/' }, ...parts.map((p, i) => {
    const to = '/' + parts.slice(0, i + 1).join('/');
    return { label: humanize(p), to };
  })];
}

function humanize(s) {
  return s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

PageHeader.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  breadcrumbs: PropTypes.array,
  actions: PropTypes.node,
};

export default PageHeader;

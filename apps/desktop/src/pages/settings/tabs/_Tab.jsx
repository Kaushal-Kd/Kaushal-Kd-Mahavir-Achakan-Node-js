import PropTypes from 'prop-types';

/**
 * Settings tab wrapper.
 *
 * Each tab renders as a full page (not a boxed modal):
 *  - Large page title + description on the left.
 *  - Optional right-aligned `actions` (buttons, filters, links).
 *  - Divider separating header from content.
 *  - Children render on the page surface with generous spacing.
 *
 * Tabs that need their own internal sections should wrap them with
 * <Section /> below for a consistent look.
 */
const Tab = ({
  title,
  description = '',
  actions = null,
  children = null,
  compact = false,
  contentClassName = '',
}) => (
  <section className={compact ? 'space-y-3 pb-2' : 'space-y-6 pb-8'}>
    <header
      className={
        compact
          ? 'flex flex-wrap items-start justify-between gap-2 border-b border-gray-200 pb-2'
          : 'flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-4'
      }
    >
      <div>
        <h2 className={compact ? 'text-lg font-semibold text-gray-900 tracking-tight' : 'text-xl font-semibold text-gray-900 tracking-tight'}>
          {title}
        </h2>
        {description ? (
          <p className={compact ? 'text-xs text-gray-500 mt-0.5 max-w-2xl' : 'text-sm text-gray-500 mt-1 max-w-2xl'}>
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex max-w-full items-center gap-2 overflow-x-auto pb-1 [&>*]:shrink-0">
          {actions}
        </div>
      ) : null}
    </header>
    <div className={compact ? `space-y-3 ${contentClassName}`.trim() : `space-y-6 ${contentClassName}`.trim()}>
      {children}
    </div>
  </section>
);

Tab.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  actions: PropTypes.node,
  children: PropTypes.node,
  compact: PropTypes.bool,
  contentClassName: PropTypes.string,
};

/**
 * A self-contained card used inside a Tab for grouped fields.
 * Optional `title`, `description`, and right-aligned `actions`.
 */
export const Section = ({
  title = '',
  description = '',
  actions = null,
  children = null,
  padded = true,
  className = '',
}) => (
  <div className={`card ${padded ? 'p-5' : ''} ${className}`}>
    {title || description || actions ? (
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          {title ? (
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          ) : null}
          {description ? (
            <p className="text-xs text-gray-500 mt-0.5">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    ) : null}
    {children}
  </div>
);

Section.propTypes = {
  title: PropTypes.string,
  description: PropTypes.string,
  actions: PropTypes.node,
  children: PropTypes.node,
  padded: PropTypes.bool,
  className: PropTypes.string,
};

export default Tab;

import { AlertCircle } from 'lucide-react';
import PropTypes from 'prop-types';
import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
          <div className="card p-8 max-w-lg text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-brand-light text-brand flex items-center justify-center mb-4">
              <AlertCircle size={22} />
            </div>
            <h1 className="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h1>
            <p className="text-sm text-gray-600 mb-5">
              The application hit an unexpected error. Reload to continue.
            </p>
            <button onClick={this.handleReload} className="btn-primary">
              Reload application
            </button>
            {this.state.error ? (
              <pre className="mt-6 text-left text-[11px] text-red-600 bg-red-50 p-3 rounded overflow-auto max-h-40">
                {String(this.state.error?.stack || this.state.error)}
              </pre>
            ) : null}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ErrorBoundary.propTypes = { children: PropTypes.node };

export default ErrorBoundary;

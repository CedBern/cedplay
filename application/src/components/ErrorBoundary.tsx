import React from 'react';

interface ErrorBoundaryState { hasError: boolean; error?: Error | undefined; info?: React.ErrorInfo | undefined }

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('UI ErrorBoundary caught error', error, info);
    this.setState({ info });
  }

  reset = () => this.setState({ hasError: false, error: undefined, info: undefined });

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 space-y-3 text-sm text-red-300 bg-red-950/40 rounded border border-red-800">
          <div className="font-semibold text-red-200">Une erreur inattendue s'est produite.</div>
          <div className="font-mono text-xs whitespace-pre-wrap max-h-40 overflow-auto">
            {this.state.error?.message}
          </div>
          <button onClick={this.reset} className="px-3 py-1 rounded bg-red-600 text-white text-xs hover:bg-red-500">Réessayer</button>
        </div>
      );
    }
    return this.props.children;
  }
}

import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('App Crashed:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#040d0c] text-white p-6">
          <div className="max-w-md w-full bg-[#071a19] border border-red-500/30 rounded-2xl p-8 text-center shadow-2xl">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-3xl">⚠️</span>
            </div>
            <h1 className="text-xl font-bold text-red-400 mb-3">Something went wrong</h1>
            <p className="text-sm text-zinc-400 mb-8 leading-relaxed">
              We encountered an unexpected error while loading this module. Please refresh the page to reconnect.
            </p>
            <div className="bg-[#040d0c] border border-zinc-800 rounded-lg p-3 text-left overflow-auto text-[10px] text-zinc-500 font-mono mb-8 max-h-32">
              {this.state.error?.message || 'Unknown render exception'}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-cyan-500/20"
            >
              Reload Session
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    // Reload the page to reset the application state
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Use import.meta.env.MODE for Vite environment checks instead of process.env
      const isDevelopment = import.meta.env.MODE === 'development';

      return (
        <div className="min-h-[400px] flex items-center justify-center p-4">
          <div className="bg-red-900/30 border border-red-500 p-8 rounded-2xl max-w-lg w-full text-center backdrop-blur-md shadow-2xl">
            <AlertTriangle className="h-16 w-16 text-red-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-white mb-2">Something went wrong</h2>
            <p className="text-red-200 mb-6">
              We encountered an unexpected error during the booking process. Please try again.
            </p>
            
            {isDevelopment && (
              <div className="bg-black/50 p-4 rounded text-left overflow-auto text-xs text-red-300 mb-6 max-h-40 border border-red-500/30">
                <p className="font-bold mb-1">Error Trace (Dev Only):</p>
                <p className="font-mono mb-2">{this.state.error?.toString()}</p>
                <pre className="whitespace-pre-wrap">{this.state.errorInfo?.componentStack}</pre>
              </div>
            )}

            <Button onClick={this.handleReset} className="bg-red-600 hover:bg-red-700 text-white font-semibold">
              <RefreshCw className="mr-2 h-4 w-4" />
              Restart Booking
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
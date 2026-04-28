import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

class AuthErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null,
      errorInfo: null 
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error(
      '%c[AuthErrorBoundary] Caught error:',
      'background:#dc2626;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px',
      { error, errorInfo }
    );
    
    this.setState({
      error,
      errorInfo
    });

    // Check if it's an auth-related error
    const isAuthError = 
      error?.message?.includes('refresh_token') ||
      error?.message?.includes('session') ||
      error?.message?.includes('auth');

    if (isAuthError) {
      console.error(
        '%c[AuthErrorBoundary] Auth error detected - clearing session',
        'background:#dc2626;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px'
      );
      
      // Clear any stuck auth state
      try {
        localStorage.removeItem('supabase.auth.token');
        localStorage.removeItem('sb-auth-token');
        // Clear all Supabase-related items
        Object.keys(localStorage).forEach(key => {
          if (key.includes('supabase') || key.includes('sb-')) {
            localStorage.removeItem(key);
          }
        });
      } catch (err) {
        console.error('[AuthErrorBoundary] Failed to clear localStorage:', err);
      }
    }
  }

  handleReset = () => {
    // Clear error state
    this.setState({ hasError: false, error: null, errorInfo: null });
    
    // Force a full page reload to reinitialize everything
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-red-950/40 backdrop-blur-lg border border-red-500/50 rounded-2xl p-8 text-center space-y-6">
            <div className="mx-auto w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center">
              <AlertCircle className="w-10 h-10 text-red-400" />
            </div>
            
            <div>
              <h1 className="text-2xl font-bold text-white mb-2">
                Authentication Error
              </h1>
              <p className="text-red-200 text-sm">
                We encountered an issue with your session. This usually happens when your login has expired.
              </p>
            </div>

            {this.state.error && (
              <div className="bg-black/30 rounded-lg p-3 text-left">
                <p className="text-xs font-mono text-red-300 break-all">
                  {this.state.error.toString()}
                </p>
              </div>
            )}

            <div className="space-y-3">
              <Button
                onClick={this.handleReset}
                className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Reload and Try Again
              </Button>
              
              <p className="text-xs text-gray-400">
                Your session data has been cleared. You'll need to log in again.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default AuthErrorBoundary;
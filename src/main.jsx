import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            fontFamily: 'system-ui, sans-serif',
            color: '#f8faf5',
            background: '#1a2430',
            minHeight: '100vh',
            boxSizing: 'border-box',
          }}
        >
          <h1 style={{ marginTop: 0 }}>Monkey Madness could not start</h1>
          <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto' }}>{String(this.state.error)}</pre>
          <p style={{ opacity: 0.85 }}>Open the browser developer console (F12 → Console) for the full stack trace.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

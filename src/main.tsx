import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '@fontsource/onest/600.css';
import '@fontsource/onest/700.css';
import App from './App';
import './app.css';
import { RecapAuthProvider } from './lib/auth';

class ErrorBoundary extends Component<{children: ReactNode}, {error: boolean}> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <main style={{padding: '10vw', fontFamily: 'Onest, sans-serif'}}><h1>Let’s get your workspace back.</h1><p>Something interrupted the page. Your saved library has not been cleared.</p><button onClick={() => window.location.reload()}>Reload recap</button></main> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><RecapAuthProvider><App /></RecapAuthProvider></ErrorBoundary></StrictMode>);

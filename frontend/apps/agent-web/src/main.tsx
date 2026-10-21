import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AppearanceProvider } from './hooks/useAppearance';
import './styles/theme.less';
import './styles/global.less';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppearanceProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </AppearanceProvider>
  </React.StrictMode>,
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { I18nProvider } from './i18n';
import { AuthBootstrap } from './auth';
import { queryClient } from './lib/queryClient';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <AuthBootstrap>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthBootstrap>
      </QueryClientProvider>
    </I18nProvider>
  </React.StrictMode>,
);

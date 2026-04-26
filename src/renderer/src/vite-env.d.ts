/// <reference types="vite/client" />

import type { CodexAccountsApi } from '../../preload';

declare global {
  interface Window {
    codexAccounts: CodexAccountsApi;
  }
}

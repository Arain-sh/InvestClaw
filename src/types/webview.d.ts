import type React from 'react';

type WebviewElementAttributes = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
  src?: string;
  allowpopups?: string | boolean;
  partition?: string;
  preload?: string;
  useragent?: string;
  webpreferences?: string;
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: WebviewElementAttributes;
    }
  }
}

export {};

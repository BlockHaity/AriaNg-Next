/**
 * Application entry point.
 *
 * NOTE: the shell agent owns this file together with `src/app/*`; it is kept
 * minimal here so the repository type-checks from the very first commit.
 */
import 'mdui/mdui.css';
import './styles/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function bootstrap() {
  const container = document.getElementById('root');
  if (!container) throw new Error('#root not found');

  createRoot(container).render(
    <StrictMode>
      <div style={{ padding: 24, fontFamily: 'var(--mdui-typescale-body-large-font-family)' }}>
        AriaNg Next — bootstrap placeholder
      </div>
    </StrictMode>,
  );

  document.body.classList.add('ready');
}

bootstrap();

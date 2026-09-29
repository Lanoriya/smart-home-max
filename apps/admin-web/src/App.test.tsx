import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('dispatcher application shell', () => {
  it('renders a deterministic session loading state before network requests finish', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('Проверяем сессию…');
  });
});

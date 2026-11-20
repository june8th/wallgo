import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App from '../App';

describe('App boot smoke test', () => {
  it('exports a React component function', () => {
    expect(typeof App).toBe('function');
  });

  it('renders a main landmark and Korean Wall Go heading', () => {
    const html = renderToStaticMarkup(createElement(App));

    expect(html).toMatch(/<main\b|role="main"/);
    expect(html).toMatch(/<h1\b[^>]*>[\s\S]*벽바둑[\s\S]*<\/h1>/);
  });
});

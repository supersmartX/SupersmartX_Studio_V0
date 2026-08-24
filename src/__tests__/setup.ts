import { beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
});

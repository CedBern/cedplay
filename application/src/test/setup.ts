// JSDOM setup / polyfills if needed
import '@testing-library/jest-dom/vitest';

// Polyfill ResizeObserver for Radix UI components in tests
// Minimal no-op implementation
class RO {
	observe() { /* no-op */ }
	unobserve() { /* no-op */ }
	disconnect() { /* no-op */ }
}
// Assign polyfill if missing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || RO;

// Pointer events are needed for Radix menu interactions under JSDOM.
if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as typeof PointerEvent;
if (!HTMLElement.prototype.hasPointerCapture) HTMLElement.prototype.hasPointerCapture = () => false;
if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => {};
if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => {};
if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => {};

import * as React from 'react';
import { flushSync } from 'react-dom';

import { cn } from '@/lib/utils';

type InputProps = React.ComponentProps<'input'> & { remoteActivation?: boolean };

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, remoteActivation = false, readOnly, inputMode, onKeyDown, onBlur, onClick, ...props }, ref) => {
  const [editing, setEditing] = React.useState(false);
  const activating = React.useRef(false);
  const waiting = remoteActivation && !editing && !readOnly;
  const activate = (input: HTMLInputElement) => {
    // Changer readOnly avant de redonner le focus, dans le geste utilisateur,
    // permet au clavier Android de s'ouvrir uniquement après OK / toucher.
    flushSync(() => setEditing(true));
    activating.current = true;
    input.blur();
    input.focus({ preventScroll: true });
    activating.current = false;
  };
  return (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className
      )}
      ref={ref}
      {...props}
      data-remote-input={remoteActivation ? '' : undefined}
      readOnly={readOnly || waiting}
      inputMode={waiting ? 'none' : inputMode}
      aria-description={waiting ? 'OK pour saisir, flèches pour naviguer.' : undefined}
      onKeyDown={event => {
        onKeyDown?.(event);
        if (!remoteActivation || readOnly) return;
        // Radix peut déjà avoir empêché la fermeture du dialogue en capture.
        if (event.defaultPrevented && !(editing && ['Escape', 'BrowserBack', 'GoBack'].includes(event.key))) return;
        if (waiting && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault(); event.stopPropagation(); activate(event.currentTarget);
        } else if (editing && ['Escape', 'BrowserBack', 'GoBack'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); setEditing(false);
        }
      }}
      onClick={event => { onClick?.(event); if (!event.defaultPrevented && waiting) activate(event.currentTarget); }}
      onBlur={event => { onBlur?.(event); if (!activating.current) setEditing(false); }}
    />
  );
});
Input.displayName = 'Input';

export { Input };

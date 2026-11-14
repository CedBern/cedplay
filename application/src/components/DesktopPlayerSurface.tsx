import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { HTMLAttributes } from 'react';

export function DesktopPlayerSurface({ children, title, ...props }: HTMLAttributes<HTMLDivElement> & { title: string }) {
  return (
    <DialogPrimitive.Root open>
      <DialogPrimitive.Portal container={document.body}>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black" />
        <DialogPrimitive.Content
          asChild
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <div data-remote-self {...props} className={`${props.className || ''} !z-[60]`}>
            <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

interface ParentalPinDialogProps {
  open: boolean;
  /** Code attendu. Vide = contrôle désactivé (ne devrait pas se produire en pratique). */
  pin: string;
  onOpenChange: (open: boolean) => void;
  onUnlock: () => void;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

export function ParentalPinDialog({ open, pin, onOpenChange, onUnlock }: ParentalPinDialogProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockRemaining, setLockRemaining] = useState(0);
  const timerRef = useRef<number | null>(null);
  const lockUntilRef = useRef(0);

  useEffect(() => {
    if (open) {
      setValue('');
      setError(false);
      // La limite de tentatives persiste tant que le dialogue n'a pas été réussi.
      const tick = () => {
        const remaining = Math.max(0, Math.ceil((lockUntilRef.current - Date.now()) / 1000));
        setLockRemaining(remaining);
        if (remaining === 0 && lockUntilRef.current > 0) {
          lockUntilRef.current = 0;
          setAttempts(0);
        }
      };
      tick();
      timerRef.current = window.setInterval(tick, 250);
    }
    return () => {
      if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [open]);

  const startLockout = () => {
    lockUntilRef.current = Date.now() + LOCKOUT_MS;
    setLockRemaining(Math.ceil(LOCKOUT_MS / 1000));
  };

  const submit = () => {
    if (lockUntilRef.current > Date.now()) return;
    if (value === pin) {
      setAttempts(0);
      onUnlock();
      onOpenChange(false);
      toast.success('Contenu déverrouillé pour cette session.');
    } else {
      const next = attempts + 1;
      setAttempts(next);
      setError(true);
      setValue('');
      if (next >= MAX_ATTEMPTS) {
        setError(false);
        toast.error(`Trop de tentatives. Réessaie dans ${LOCKOUT_MS / 1000} secondes.`);
        startLockout();
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Contenu protégé</DialogTitle>
          <DialogDescription>Saisis le code parental pour afficher ce groupe.</DialogDescription>
        </DialogHeader>
        <form onSubmit={e => { e.preventDefault(); submit(); }} className="space-y-3">
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            aria-label="Code parental"
            disabled={lockRemaining > 0}
            className="block w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-center text-lg tracking-widest text-white disabled:opacity-50"
            value={value}
            onChange={e => { setValue(e.target.value.replace(/\D/g, '').slice(0, 8)); setError(false); }}
            placeholder="••••"
          />
          {error && <p role="alert" className="text-sm text-red-400">Code incorrect. {MAX_ATTEMPTS - attempts} tentative{MAX_ATTEMPTS - attempts > 1 ? 's' : ''} restante{MAX_ATTEMPTS - attempts > 1 ? 's' : ''}.</p>}
          {lockRemaining > 0 && <p role="alert" className="text-sm text-amber-300">Trop de tentatives. Réessaie dans {lockRemaining} s.</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button type="submit" disabled={!value || lockRemaining > 0}>Déverrouiller</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

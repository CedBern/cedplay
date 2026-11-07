import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Le composant enfant jette au premier rendu uniquement : après « Réessayer »,
// le rendu repart normalement et le contenu remonte.
let shouldThrow = true;
function Bomb() {
  if (shouldThrow) throw new Error('Explosion de test');
  return <div>Contenu récupéré</div>;
}

afterEach(() => {
  shouldThrow = true;
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('affiche le repli d\'erreur avec le message et permet de repartir', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getByText } = render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    await waitFor(() => expect(getByText("Une erreur inattendue s'est produite.")).toBeTruthy());
    expect(screen.getByText('Explosion de test')).toBeTruthy();
    expect(consoleSpy).toHaveBeenCalled();

    // Le reset doit démonter l'état d'erreur puis re-rendre les enfants
    shouldThrow = false;
    fireEvent.click(getByText('Réessayer'));
    expect(getByText('Contenu récupéré')).toBeTruthy();
    expect(screen.queryByText("Une erreur inattendue s'est produite.")).toBeNull();
  });

  it('laisse les enfants sains s\'afficher tels quels', () => {
    render(
      <ErrorBoundary>
        <div>Contenu normal</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Contenu normal')).toBeTruthy();
  });
});

import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground p-6 text-center">
      <div className="space-y-6 max-w-md">
        <div className="space-y-3">
          <h1 className="text-8xl font-bold text-primary">404</h1>
          <h2 className="text-2xl font-semibold text-white">Page introuvable</h2>
          <p className="text-neutral-400">Cette page n'existe pas ou a été déplacée.</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild>
            <a href="/">Retour à l'accueil</a>
          </Button>
          <Button variant="outline" onClick={() => window.history.back()}>
            Revenir en arrière
          </Button>
        </div>
      </div>
    </div>
  );
}

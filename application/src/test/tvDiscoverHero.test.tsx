import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TvDiscoverHero, type TvDiscoverSelection } from '@/components/TvDiscoverHero';

afterEach(cleanup);
const selection: TvDiscoverSelection = { key: 'film', eyebrow: 'Film · Ma liste', title: 'Le grand voyage', image: 'https://example.test/poster.jpg', imageLayout: 'poster', hints: 'OK Fiche' };

it('montre la véritable affiche et reste hors du parcours de focus', () => {
  const { container } = render(<TvDiscoverHero selection={selection} />);
  expect(screen.getByRole('heading', { name: 'Le grand voyage' })).toBeVisible();
  expect(container.querySelector('img')).toHaveAttribute('src', selection.image);
  expect(container.querySelector('section')).toHaveAttribute('data-image-layout', 'poster');
  expect(container.querySelector('button, a, [tabindex]')).toBeNull();
});

it('refuse une URL non HTTP et garde le titre sans image', () => {
  const { container } = render(<TvDiscoverHero selection={{ ...selection, image: 'javascript:alert(1)' }} />);
  expect(container.querySelector('img')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Le grand voyage' })).toBeVisible();
});

it('garde un titre long et ses informations dans le rendu compact sans illustration', () => {
  const title = 'Une chaîne sans illustration avec un très long titre de programme à conserver en entier';
  const { container } = render(<TvDiscoverHero selection={{ ...selection, title, image: undefined, imageLayout: 'logo', meta: 'Programme non renseigné', description: 'La description disponible reste présente.' }} />);
  expect(container.querySelector('section')).toHaveAttribute('data-has-image', 'false');
  expect(screen.getByRole('heading', { name: title })).toHaveTextContent(title);
  expect(screen.getByText('Programme non renseigné')).toBeVisible();
  expect(screen.getByText('La description disponible reste présente.')).toBeVisible();
});

it('garde les textes après erreur image puis accepte le visuel du nouveau contenu', () => {
  const { container, rerender } = render(<TvDiscoverHero selection={selection} />);
  fireEvent.error(container.querySelector('img')!);
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('section')).toHaveAttribute('data-has-image', 'false');
  expect(screen.getByRole('heading', { name: selection.title })).toBeVisible();
  expect(screen.getByText('OK Fiche')).toBeVisible();
  rerender(<TvDiscoverHero selection={{ ...selection, key: 'autre', title: 'Autre film', image: 'https://example.test/other.jpg' }} />);
  expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.test/other.jpg');
});

it('affiche le logo vectoriel d’une chaîne sans URL ou après erreur', () => {
  const { container } = render(<TvDiscoverHero selection={{
    key: 'live:tf1',
    eyebrow: 'En direct · TF1',
    title: 'Journal de 20 heures',
    channelName: 'TF1',
    image: undefined,
    imageLayout: 'logo',
    hints: 'OK Regarder',
  }} />);
  expect(container.querySelector('section')).toHaveAttribute('data-has-image', 'true');
  const svg = container.querySelector('svg');
  expect(svg).not.toBeNull();
  expect(container.querySelector('img')).toBeNull();
});

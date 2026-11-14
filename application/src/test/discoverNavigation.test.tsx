import userEvent from '@testing-library/user-event';
import 'fake-indexeddb/auto';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ContinuePanel } from '@/components/ContinuePanel';
import { MainNavigation } from '@/components/MainNavigation';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { useRemoteNavigation } from '@/hooks/useRemoteNavigation';
import { setMeta } from '@/utils/idb';
vi.mock('@/hooks/useBodlavDocumentaries', () => ({ useBodlavDocumentaries: () => [] }));
vi.mock('@/hooks/useOfficialDocumentaries', () => ({ useOfficialDocumentaries: () => [] }));

const channel = { id:'c', name:'Chaîne témoin', url:'https://example.test/live.ts' };
const playlist = { id:'navigation', name:'Navigation', channels:[channel], groups:[{name:'Test',channels:[channel]}] };
function Page() {
  useRemoteNavigation();
  const [tab,setTab] = useState('continue');
  return <Tabs value={tab} activationMode="manual" onValueChange={setTab}>
    <MainNavigation tv onNavigate={setTab}/>
    <TabsContent value="continue"><ContinuePanel playlist={playlist} tvMode onChannelSelect={()=>{}} onOpenVod={()=>{}}/></TabsContent>
    <TabsContent value="channels"><button data-remote-entry>Liste Direct</button></TabsContent>
  </Tabs>;
}
beforeEach(async()=>{
  localStorage.clear();
  await setMeta('favorites',['c']); await setMeta('vod_watchlist',[]);
  await setMeta('playHistory',[{channelId:'vod:navigation:movie:1', name:'Film témoin',kind:'vod',ts:10,positionMs:120000}]);
  // Des positions identiques obligent la page à suivre sa structure, pas un voisin géométrique arbitraire.
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:80,bottom:40,width:80,height:40,toJSON(){}});
  vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();document.documentElement.classList.remove('tv-mode','remote-navigation');});
const key=(name:string)=>fireEvent.keyDown(document.activeElement!,{key:name});
async function ready(){render(<Page/>);await screen.findByRole('region',{name:'Reprendre'});}
it('remonte des cartes aux filtres puis au menu sans changer de rubrique',async()=>{
  // Reprendre est la première rangée : Haut depuis sa carte rejoint les filtres.
  await ready(); const card=screen.getByRole('button',{name:'Reprendre Film témoin'});card.focus();
  key('ArrowUp'); expect(screen.getByRole('button',{name:'Tout'})).toHaveFocus();
  key('ArrowUp'); expect(screen.getByRole('tab',{name:'Découvrir'})).toHaveFocus();
  expect(screen.getByRole('region',{name:'Reprendre'})).toBeVisible();
});
it('sépare le déplacement entre cartes, leurs actions et les rangées suivantes',async()=>{
  await ready(); const liveCard=within(screen.getByRole('region',{name:'Mes chaînes en ce moment'})).getByRole('button');
  const resume=screen.getByRole('button',{name:'Reprendre Film témoin'});resume.focus();
  key('ArrowDown');expect(screen.getByRole('button',{name:'Fiche de Film témoin'})).toHaveFocus();
  key('ArrowUp');expect(resume).toHaveFocus();
  key('ArrowDown');key('ArrowDown');expect(liveCard).toHaveFocus();
  key('ArrowUp');expect(resume).toHaveFocus();
});
it('Retour depuis les filtres rejoint le menu au lieu de laisser sortir de l’accueil',async()=>{
  await ready();screen.getByRole('button',{name:'Tout'}).focus();
  const back=new Event('iptv-back',{cancelable:true});window.dispatchEvent(back);
  expect(back.defaultPrevented).toBe(true);expect(screen.getByRole('tab',{name:'Découvrir'})).toHaveFocus();
});


it('le menu ne change de rubrique qu’avec OK et Direct reste accessible après un aller-retour', async () => {
  await ready();
  const card=screen.getByRole('button',{name:'Reprendre Film témoin'});card.focus();
  key('ArrowUp'); key('ArrowUp'); key('ArrowDown');
  expect(screen.getByRole('tab',{name:'Direct'})).toHaveFocus();
  expect(screen.getByRole('tab',{name:'Découvrir'})).toHaveAttribute('aria-selected','true');
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('button',{name:'Liste Direct'})).toBeVisible();
  key('ArrowRight'); expect(screen.getByRole('button',{name:'Liste Direct'})).toHaveFocus();
  key('ArrowUp'); key('ArrowUp');
  await userEvent.keyboard('{Enter}');
  expect(await screen.findByRole('region',{name:'Reprendre'})).toBeVisible();
  expect(screen.getByRole('tab',{name:'Découvrir'})).toHaveAttribute('aria-selected','true');
});

it('Gauche au bord des filtres et de la première carte ouvre le rail ; Droite revient à la carte', async () => {
  await ready();
  const card=within(screen.getByRole('region',{name:'Mes chaînes en ce moment'})).getByRole('button');
  card.focus(); key('ArrowLeft');
  expect(screen.getByRole('tab',{name:'Découvrir'})).toHaveFocus();
  key('ArrowRight'); expect(card).toHaveFocus();
  screen.getByRole('button',{name:'Tout'}).focus(); key('ArrowLeft');
  expect(screen.getByRole('tab',{name:'Découvrir'})).toHaveFocus();
});

it('Droite depuis le rail arrive sur la première carte de Reprendre, sans passer par les filtres', async () => {
  await ready();
  screen.getByRole('tab',{name:'Découvrir'}).focus(); key('ArrowRight');
  expect(screen.getByRole('button',{name:'Reprendre Film témoin'})).toHaveFocus();
  expect(screen.getByRole('button',{name:'Tout'})).not.toHaveAttribute('data-remote-entry');
});

it('Reprendre est la première rangée et l’écran signale son bandeau', async () => {
  await ready();
  const rows=Array.from(document.querySelectorAll('[data-discover-row]')).map(row=>row.getAttribute('data-discover-row'));
  expect(rows).toEqual(['resume','live-now','tv5-documentaries','imago-documentaries']);
  expect(document.querySelector('[data-discover-screen]')).toHaveAttribute('data-discover-has-hero');
});

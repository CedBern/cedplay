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
  await ready(); screen.getByRole('button',{name:'Reprendre Film témoin'}).focus();
  key('ArrowUp'); expect(screen.getByRole('button',{name:'Tout'})).toHaveFocus();
  key('ArrowUp'); expect(screen.getByRole('tab',{name:'Découvrir'})).toHaveFocus();
  expect(screen.getByRole('region',{name:'Reprendre'})).toBeVisible();
});
it('sépare le déplacement entre cartes, leurs actions et les rangées suivantes',async()=>{
  await ready(); const play=screen.getByRole('button',{name:'Reprendre Film témoin'});play.focus();
  key('ArrowDown');expect(screen.getByRole('button',{name:'Fiche de Film témoin'})).toHaveFocus();
  key('ArrowDown');expect(within(screen.getByRole('region',{name:'Mes chaînes en ce moment'})).getByRole('button')).toHaveFocus();
  key('ArrowUp');expect(play).toHaveFocus();
});
it('Retour depuis les filtres rejoint le menu au lieu de laisser sortir de l’accueil',async()=>{
  await ready();screen.getByRole('button',{name:'Tout'}).focus();
  const back=new Event('iptv-back',{cancelable:true});window.dispatchEvent(back);
  expect(back.defaultPrevented).toBe(true);expect(screen.getByRole('tab',{name:'Découvrir'})).toHaveFocus();
});


it('le menu ne change de rubrique qu’avec OK et Direct reste accessible après un aller-retour', async () => {
  await ready();
  screen.getByRole('button',{name:'Reprendre Film témoin'}).focus();
  key('ArrowUp'); key('ArrowUp'); key('ArrowRight');
  expect(screen.getByRole('tab',{name:'Direct'})).toHaveFocus();
  expect(screen.getByRole('tab',{name:'Découvrir'})).toHaveAttribute('aria-selected','true');
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('button',{name:'Liste Direct'})).toBeVisible();
  key('ArrowDown'); expect(screen.getByRole('button',{name:'Liste Direct'})).toHaveFocus();
  key('ArrowUp'); key('ArrowLeft');
  await userEvent.keyboard('{Enter}');
  expect(await screen.findByRole('region',{name:'Reprendre'})).toBeVisible();
  expect(screen.getByRole('tab',{name:'Découvrir'})).toHaveAttribute('aria-selected','true');
});

import { chromium } from 'playwright';
const APP='http://localhost:5173';
const b=await chromium.launch({channel:'chrome',headless:true});
const stamp=Date.now().toString(36); const errs=[]; let fails=0;
const ok=(l,c,x)=>{console.log(`${c?'  ok  ':' FAIL '} ${l}${!c&&x!==undefined?` — ${JSON.stringify(x).slice(0,200)}`:''}`); if(!c)fails++;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function up(h,face){
  const ctx=await b.newContext();
  const p=await ctx.newPage({viewport:{width:1280,height:800}});
  p.on('pageerror',e=>errs.push(`${h}: ${String(e).slice(0,140)}`));
  await p.goto(`${APP}/signup`,{waitUntil:'networkidle'});
  await p.fill('input[type=text]',h); await p.fill('input[type=password]','correct horse battery staple');
  await p.waitForFunction(()=>![...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Continue')?.disabled);
  await p.getByRole('button',{name:'Continue'}).click();
  await p.waitForSelector('text=YOUR RECOVERY CODE',{timeout:60000});
  await p.goto(`${APP}/app?e2e=1`,{waitUntil:'load'});
  for(let i=0;i<60;i++){ if(await p.evaluate(()=>window.__revel?.live?.running??false))break; await wait(1000);}
  await wait(1200);
  await p.evaluate(async n=>{await window.__revel.myFaces.create(n); window.__revel.onboarding?.dismiss?.();},face);
  return p;
}
async function dm(from, handle){
  await from.getByTitle('Message someone').click();
  await from.fill('input[aria-label="Who do you want to message?"]', handle);
  await from.getByRole('button',{name:'Start'}).click();
  await wait(4000);
}
const A=`ya${stamp}`, B=`yb${stamp}`, C=`yc${stamp}`;
const a=await up(A,'Viola'), bp=await up(B,'Rae'), c=await up(C,'Kit');
await dm(a, B); await a.evaluate(()=>window.__revel.core.send('from alice'));
await dm(c, B); await c.evaluate(()=>window.__revel.core.send('from kit'));
await wait(3000);
await bp.evaluate(async()=>{const{live}=window.__revel; await live.stack.sync(); await live.refreshRooms();});
await wait(4000);
ok('bob has two conversations', (await bp.evaluate(()=>window.__revel.core.dms.length))===2);

// Bob deliberately opens Kit's, so Alice's is the one he is *not* looking at.
const kitRoom = await bp.evaluate(async ()=>{
  const {live,core}=window.__revel;
  for (const d of core.dms) {
    const st = await live.stack.core.conversation.open(d.id);
    if (st.messages.some(m=>m.body==='from kit')) { core.openHome(d.id); return d.id; }
  }
  return null;
});
await wait(3000);
ok('bob is looking at kit', !!kitRoom);
ok("alice's room is clear to start", await bp.evaluate(k=>!window.__revel.core.dms.find(d=>d.id!==k)?.unread, kitRoom));

await a.evaluate(()=>{const c=window.__revel.core; c.send('one'); });
await wait(1200);
await a.evaluate(()=>window.__revel.core.send('two'));
await wait(4000);
const badges = await bp.evaluate(k=>window.__revel.core.dms.map(d=>({mine:d.id===k,unread:d.unread})), kitRoom);
ok('badge on the room bob is not in', badges.find(x=>!x.mine)?.unread===2, badges);
ok('no badge on the one he is', badges.find(x=>x.mine)?.unread===undefined, badges);
ok('rail dot shows', await bp.evaluate(()=>!!document.querySelector('[aria-label="unread"]')));
await bp.screenshot({ path:'/tmp/unread.png' });

// Switching to it clears it.
await bp.evaluate(k=>{const c=window.__revel.core; c.openHome(c.dms.find(d=>d.id!==k).id);}, kitRoom);
await wait(3000);
ok('switching clears it', await bp.evaluate(()=>!window.__revel.core.dms.some(d=>d.unread)), await bp.evaluate(()=>window.__revel.core.dms.map(d=>d.unread)));

// And a reload comes back to the room bob actually chose, not the first one.
await bp.reload({ waitUntil:'load' });
for(let i=0;i<60;i++){ if(await bp.evaluate(()=>window.__revel?.live?.running??false))break; await wait(1000);}
await wait(5000);
ok('reload restores the room bob chose', await bp.evaluate(k=>window.__revel.core.currentRoomId!==k && window.__revel.core.dms.some(d=>d.id===window.__revel.core.currentRoomId), kitRoom),
   await bp.evaluate(()=>window.__revel.core.currentRoomId));
console.log('page errors:', errs.length?errs:'none');
await b.close(); process.exitCode=fails?1:0;

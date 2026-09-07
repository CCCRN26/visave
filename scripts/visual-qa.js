import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import nextEnv from "@next/env";
import { CdpWebSocket } from "./lib/cdp-websocket.js";

nextEnv.loadEnvConfig(process.cwd());
const database = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (database !== "cccrn_vsla_acceptance") throw new Error(`Refusing visual QA against ${database}`);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const fixture = (await db.query(`SELECT
  (SELECT fp.id FROM facilitator_profiles fp WHERE fp.status='ACTIVE' ORDER BY fp.created_at DESC LIMIT 1) facilitator_id,
  (SELECT g.id FROM vsla_groups g WHERE g.name='Phase 2B Acceptance Group' LIMIT 1) group_id,
  (SELECT m.id FROM vsla_meetings m JOIN vsla_groups g ON g.id=m.group_id WHERE g.name='Phase 2B Acceptance Group' ORDER BY m.created_at DESC LIMIT 1) meeting_id,
  (SELECT m.id FROM vsla_meetings m WHERE m.status='OPEN' ORDER BY m.created_at DESC LIMIT 1) open_meeting_id,
  (SELECT m.group_id FROM vsla_meetings m WHERE m.status='OPEN' ORDER BY m.created_at DESC LIMIT 1) open_meeting_group_id,
  (SELECT d.group_id FROM constitution_documents d WHERE d.archived_at IS NULL ORDER BY d.uploaded_at DESC LIMIT 1) document_group_id,
  (SELECT g.id FROM vsla_groups g JOIN group_constitutions c ON c.group_id=g.id LEFT JOIN constitution_documents d ON d.constitution_id=c.id WHERE d.id IS NULL ORDER BY g.created_at DESC LIMIT 1) no_document_group_id,
  (SELECT u.email FROM users u JOIN group_members gm ON gm.linked_user_id=u.id WHERE gm.status='ACTIVE' AND u.status='ACTIVE' AND u.email LIKE 'p2fa.%@example.org' ORDER BY u.created_at DESC LIMIT 1) officer_email`)).rows[0];
await db.end();

const tabs = await (await fetch("http://127.0.0.1:9222/json/list")).json();
if (!tabs[0]?.webSocketDebuggerUrl) throw new Error("Chrome debugging target unavailable");
const socket = await new CdpWebSocket(tabs[0].webSocketDebuggerUrl).connect();
let id = 0;
const pending = new Map();
socket.on("message", ({ data }) => { const message=JSON.parse(data); if(message.id&&pending.has(message.id)){const {resolve,reject}=pending.get(message.id);pending.delete(message.id);message.error?reject(new Error(message.error.message)):resolve(message.result);} });
const send = (method, params={}) => new Promise((resolve,reject) => { const call=++id; pending.set(call,{resolve,reject}); socket.send(JSON.stringify({id:call,method,params})); });
const wait = (ms=500) => new Promise(resolve => setTimeout(resolve,ms));
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
const navigate = async (url) => { await send("Page.navigate",{url:`http://localhost:3000${url}`});await wait(900); };
const evaluate = async (expression) => (await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true})).result.value;
const login = async (email,password) => { await send("Network.clearBrowserCookies");await navigate("/login");const status=await evaluate(`fetch('/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)},password:${JSON.stringify(password)}})}).then(r=>r.status)`);if(status!==200)throw new Error(`Visual login failed ${email}: ${status}`); };
const out = path.join(process.cwd(),"artifacts","visual-qa");await fs.mkdir(out,{recursive:true});
const viewports=[{name:"1440",width:1440,height:900},{name:"768",width:768,height:1024},{name:"390",width:390,height:844}],results=[];
const inspect = async (screen,url,viewport,prepare) => {
  await send("Emulation.setDeviceMetricsOverride",{width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:viewport.width<600});await navigate(url);if(prepare){await evaluate(prepare);await wait(300);}
  const state=await evaluate(`(()=>({url:location.pathname,overflow:document.documentElement.scrollWidth>window.innerWidth,bad:['undefined','NaN','[object Object]','Invalid Date'].filter(x=>document.body.innerText.includes(x)),title:document.querySelector('h1,h2')?.textContent?.trim()||''}))()`);
  const shot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});const filename=`${screen}-${viewport.name}.png`;await fs.writeFile(path.join(out,filename),Buffer.from(shot.data,"base64"));results.push({screen,viewport:viewport.name,...state,screenshot:filename});
};

await login(process.env.SEED_ADMIN_EMAIL,process.env.SEED_ADMIN_PASSWORD);
for(const viewport of viewports){
  await inspect("agent-edit",`/facilitators/${fixture.facilitator_id}/edit`,viewport);
  await inspect("meeting",`/groups/${fixture.group_id}/meetings/${fixture.meeting_id}`,viewport);
  await inspect("current-cycle-finance",`/groups/${fixture.group_id}`,viewport);
  await inspect("archive-modal",`/groups/${fixture.group_id}`,viewport,`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Archive Group')?.click();return true})()`);
  await inspect("constitution-uploaded",`/groups/${fixture.document_group_id}/constitution`,viewport);
  await inspect("constitution-empty",`/groups/${fixture.no_document_group_id}/constitution`,viewport);
}
const pointer={available:false};
if(fixture.open_meeting_id){
  for(const viewport of viewports)await inspect("signature-pad",`/groups/${fixture.open_meeting_group_id}/meetings/${fixture.open_meeting_id}`,viewport,`(()=>{document.querySelector('canvas')?.scrollIntoView({block:'center'});return true})()`);
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});await navigate(`/groups/${fixture.open_meeting_group_id}/meetings/${fixture.open_meeting_id}`);
  const canvas=await evaluate(`(()=>{const c=document.querySelector('canvas');if(!c)return null;c.scrollIntoView({block:'center'});const r=c.getBoundingClientRect(),save=[...document.querySelectorAll('button')].find(b=>/save reconciliation/i.test(b.textContent));return{x:r.left+24,y:r.top+24,beforeDisabled:!!save?.disabled,touchAction:getComputedStyle(c).touchAction,canvasFits:r.right<=window.innerWidth}})()`);
  if(canvas){
    await send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:1});
    await send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:canvas.x,y:canvas.y}]});
    await send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:canvas.x+90,y:canvas.y+50}]});
    await send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await wait(250);
    const after=await evaluate(`(()=>{const save=[...document.querySelectorAll('button')].find(b=>/save reconciliation/i.test(b.textContent)),clear=[...document.querySelectorAll('button')].find(b=>/clear/i.test(b.textContent));return{afterDrawingDisabled:!!save?.disabled,clearPresent:!!clear,clearLabel:clear?.textContent?.trim()||null}})()`);
    Object.assign(pointer,{available:true,...canvas,...after});
    const shot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});await fs.writeFile(path.join(out,"signature-pad-390.png"),Buffer.from(shot.data,"base64"));
    await evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>/clear/i.test(b.textContent))?.click();return true})()`);
  }
}
if(fixture.officer_email){await login(fixture.officer_email,"Phase2FA-Test-2026!");for(const viewport of viewports)await inspect("officer-dashboard","/dashboard",viewport);}
socket.close();
if(results.some(r=>r.overflow||r.bad.length))throw new Error(`Visual rendering defects: ${JSON.stringify(results.filter(r=>r.overflow||r.bad.length))}`);
if(!pointer.available||!pointer.beforeDisabled||!pointer.clearPresent||pointer.touchAction!=="none"||!pointer.canvasFits)throw new Error(`Signature pointer QA failed: ${JSON.stringify(pointer)}`);
console.log(JSON.stringify({database,fixture,results,pointer},null,2));

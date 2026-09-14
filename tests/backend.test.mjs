import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {Exchange,verifyStripeSignature} from "../backend/worker.js";
const C=globalThis.MreoCore;
function context(){
 const data=new Map();let queue=Promise.resolve(),alarm=null;
 return {data,storage:{get:async k=>data.has(k)?structuredClone(data.get(k)):undefined,put:async(k,v)=>data.set(k,structuredClone(v)),list:async({prefix=""}={})=>new Map([...data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)])),setAlarm:async v=>{alarm=v;},deleteAlarm:async()=>{alarm=null;}},
 blockConcurrencyWhile(fn){const result=queue.then(fn);queue=result.catch(()=>{});return result;}};
}
const env={STRIPE_SECRET_KEY:"sk_test_example",STRIPE_WEBHOOK_SECRET:"whsec_example",SITE_URL:"https://example.com/MREO_BuySell"};
const request=(path,method="GET",body,token)=>new Request("https://api.example.com"+path,{method,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},body:body?JSON.stringify(body):undefined});
async function register(exchange,role){const r=await exchange.fetch(request("/register","POST",{role,details:{name:role,email:role+"@example.com"},submission:{title:"Test listing",minimum:250000,days:1,kind:"property"}}));assert.equal(r.status,201);return r.json();}
test("only correct current webhook signatures are accepted",async()=>{
 const raw='{"type":"checkout.session.completed"}',now=Date.now(),t=String(Math.floor(now/1000)),secret="whsec_test";
 const sig=createHmac("sha256",secret).update(t+"."+raw).digest("hex");
 await verifyStripeSignature(raw,"t="+t+",v1="+sig,secret,now);
 await assert.rejects(()=>verifyStripeSignature(raw+" ","t="+t+",v1="+sig,secret,now),/Invalid/);
 await assert.rejects(()=>verifyStripeSignature(raw,"t="+t+",v1="+sig,secret,now+301000),/Expired/);
});
test("payment credit is verified, bound to an account, and idempotent",async()=>{
 const ctx=context(),ex=new Exchange(ctx,env),a=await register(ex,"buyer");
 const record=ctx.data.get("account:"+a.id);record.checkoutSession="cs_test_valid";ctx.data.set("account:"+a.id,record);
 const paid={id:"cs_test_valid",metadata:{mreo_account_id:a.id},payment_status:"paid",currency:"usd",amount_total:100,livemode:false,customer:"cus_test",payment_intent:"pi_test"};
 await assert.rejects(()=>ex.credit({...paid,amount_total:1}),/not been verified/);
 await assert.rejects(()=>ex.credit({...paid,livemode:true}),/not been verified/);
 await assert.rejects(()=>ex.credit({...paid,id:"cs_test_wrong"}),/not been verified/);
 await ex.credit(paid);await ex.credit(paid);assert.equal(ctx.data.get("account:"+a.id).creditCents,100);
 assert.equal([...ctx.data.keys()].filter(k=>k.startsWith("ledger:")).length,1);
 record.revokedAt=Date.now();ctx.data.set("account:"+a.id,record);
 await assert.rejects(()=>ex.credit(paid),/refunded or disputed/);
});
test("authentication and payment gate protect auctions and seller data",async()=>{
 const ctx=context(),ex=new Exchange(ctx,env),seller=await register(ex,"seller"),buyer=await register(ex,"buyer");
 let r=await ex.fetch(request("/activate","POST",{},seller.token));assert.equal(r.status,403);
 const s=ctx.data.get("account:"+seller.id);s.creditCents=100;ctx.data.set("account:"+seller.id,s);
 r=await ex.fetch(request("/activate","POST",{},seller.token));assert.equal(r.status,201);const {auctionId}=await r.json();
 r=await ex.fetch(request("/auctions/"+auctionId+"?view=seller","GET",null,buyer.token));assert.equal(r.status,403);
 r=await ex.fetch(request("/auctions/"+auctionId+"/bids","POST",{amount:260000},buyer.token));assert.equal(r.status,403);
 r=await ex.fetch(request("/auctions/"+auctionId+"/bids","POST",{amount:260000},"forged.token"));assert.equal(r.status,401);
 r=await ex.fetch(request("/activate","POST",{},seller.token));assert.equal((await r.json()).auctionId,auctionId);
});
test("concurrent equal blind bids are both saved and expired auctions reject late bids",async()=>{
 const ctx=context(),ex=new Exchange(ctx,env),buyer1=await register(ex,"buyer"),buyer2=await register(ex,"buyer");
 for(const user of [buyer1,buyer2]){const a=ctx.data.get("account:"+user.id);a.creditCents=100;ctx.data.set("account:"+user.id,a);}
 const a=C.createAuction({id:"test-auction",sellerId:"seller",title:"Test",minimum:250000});ctx.data.set("auction:"+a.id,a);
 const replies=await Promise.all([buyer1,buyer2].map(user=>ex.fetch(request("/auctions/"+a.id+"/bids","POST",{amount:260000},user.token))));
 assert.deepEqual(replies.map(r=>r.status),[201,201]);assert.equal(ctx.data.get("auction:"+a.id).bids.length,2);
 const expired=ctx.data.get("auction:"+a.id);expired.endsAt=Date.now()-100;ctx.data.set("auction:"+a.id,expired);await ex.alarm();
 const closed=ctx.data.get("auction:"+a.id);assert.equal(closed.status,"closed");assert.equal(closed.winnerId,closed.bids[0].buyerId);
 assert.ok([...ctx.data.keys()].some(k=>k.startsWith("notice:")));
 const late=await ex.fetch(request("/auctions/"+a.id+"/bids","POST",{amount:300000},buyer2.token));assert.equal(late.status,400);
});
test("connected buyers cannot discover competing amounts through auctions or notifications",async()=>{
 const ctx=context(),ex=new Exchange(ctx,env),seller=await register(ex,"seller"),winner=await register(ex,"buyer"),loser=await register(ex,"buyer");
 for(const user of [winner,loser])ctx.data.get("account:"+user.id).creditCents=100;
 const a=C.createAuction({id:"blind-auction",sellerId:seller.id,title:"Blind listing",minimum:250000});ctx.data.set("auction:"+a.id,a);
 const route="/auctions/"+a.id;
 for(const [user,amount] of [[winner,500000],[loser,270000],[loser,270001]]){
  const r=await ex.fetch(request(route+"/bids","POST",{amount},user.token));assert.equal(r.status,201);
 }
 const get=async(path,token)=>(await ex.fetch(request(path,"GET",null,token))).json();
 const buyer=await get(route,loser.token);
 assert.deepEqual(buyer.auction.bids.map(b=>b.amount),[270000,270001]);assert.equal(buyer.auction.bidCount,3);
 assert.equal(buyer.auction.viewerOutcome,"submitted");assert.equal("winnerId" in buyer.auction,false);
 assert.equal(JSON.stringify(buyer).includes("500000"),false);
 assert.equal((await get(route)).auction.bids.length,0);
 assert.equal((await get(route,winner.token)).auction.viewerOutcome,"submitted");
 assert.equal((await get(route+"?view=seller",seller.token)).auction.bids.length,3);
 assert.equal((await get(route+"?view=buyer",seller.token)).auction.bids.length,0);
 assert.equal((await ex.fetch(request(route+"?view=seller&actor=test-seller","GET",null,loser.token))).status,403);
 const listing=(await get("/auctions")).auctions[0];assert.equal("bids" in listing,false);assert.equal("highest" in listing,false);
 ctx.data.get("auction:"+a.id).endsAt=Date.now()-1;await ex.alarm();
 const loserResult=await get(route,loser.token);assert.equal(loserResult.auction.viewerOutcome,"lost");assert.equal(JSON.stringify(loserResult).includes("500000"),false);
 assert.equal((await get(route,winner.token)).auction.viewerOutcome,"won");
 // Both newly generated and older stored buyer notices must remain blind.
 const noticeKey="notice:"+loser.id+":"+a.id;
 assert.equal("highest" in ctx.data.get(noticeKey),false);
 ctx.data.get(noticeKey).highest=500000;
 const notices=await get("/notifications",loser.token);assert.equal("highest" in notices.notifications[0],false);assert.equal(notices.notifications[0].outcome,"lost");
 assert.equal((await get("/notifications",winner.token)).notifications[0].outcome,"won");
 assert.equal((await get("/notifications",seller.token)).notifications[0].highest,500000);
});

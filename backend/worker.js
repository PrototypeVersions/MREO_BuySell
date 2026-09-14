import "../auction-core.js";

"use strict";
const C=globalThis.MreoCore;
class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("");
const sha=async text=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text))));
const constantEqual=(a,b)=>{if(a.length!==b.length)return false;let result=0;for(let i=0;i<a.length;i++)result|=a.charCodeAt(i)^b.charCodeAt(i);return result===0;};
async function limitedText(request){const reader=request.body?.getReader();if(!reader)return "";let size=0;const chunks=[];for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>1500000){await reader.cancel();throw new HttpError("Request is too large.",413);}chunks.push(r.value);}const out=new Uint8Array(size);let n=0;for(const c of chunks){out.set(c,n);n+=c.length;}return new TextDecoder().decode(out);}
async function bodyJSON(request){if(!(request.headers.get("Content-Type")||"").includes("application/json"))throw new HttpError("Use application/json.",415);try{return JSON.parse(await limitedText(request));}catch(e){if(e instanceof HttpError)throw e;throw new HttpError("Invalid JSON.");}}
function siteURL(env){let url;try{url=new URL(env.SITE_URL);}catch{throw new HttpError("SITE_URL is not configured.",503);}if(url.protocol!=="https:")throw new HttpError("SITE_URL must use HTTPS.",503);return url.href.replace(/\/$/,"");}
function checkStripe(env){if(!env.STRIPE_SECRET_KEY||!/^sk_(test|live)_/.test(env.STRIPE_SECRET_KEY))throw new HttpError("Stripe is not configured.",503);if(env.STRIPE_SECRET_KEY.startsWith("sk_live_")&&env.ALLOW_LIVE_PAYMENTS!=="true")throw new HttpError("Live payments have not been enabled.",503);}
async function stripe(env,path,params=null,idempotencyKey=null){
 checkStripe(env);const response=await fetch("https://api.stripe.com/v1"+path,{method:params?"POST":"GET",headers:{Authorization:"Bearer "+env.STRIPE_SECRET_KEY,...(params?{"Content-Type":"application/x-www-form-urlencoded"}:{}),...(idempotencyKey?{"Idempotency-Key":idempotencyKey}:{})},body:params?new URLSearchParams(params):undefined,signal:AbortSignal.timeout(15000)});
 const data=await response.json();if(!response.ok)throw new HttpError("The payment provider could not complete the request. Please try again.",502);return data;
}
async function verifyStripeSignature(raw,header,secret,now=Date.now()){
 if(!secret||!header)throw new HttpError("Missing webhook signature.",400);
 const entries=header.split(",").map(s=>s.trim().split("=")),timestamp=entries.find(([k])=>k==="t")?.[1],signatures=entries.filter(([k])=>k==="v1").map(([,v])=>v);
 if(!/^\d+$/.test(timestamp||"")||Math.abs(now/1000-Number(timestamp))>300)throw new HttpError("Expired webhook signature.");
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const digest=hex(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(timestamp+"."+raw))));
 if(!signatures.some(s=>constantEqual(s,digest)))throw new HttpError("Invalid webhook signature.");
}
function validDetails(details){const name=String(details?.name||"").trim().slice(0,120),email=String(details?.email||"").trim().slice(0,254);if(!name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError("Provide your name and a valid email address.");return {name,email};}
function validSubmission(role,data){
 const title=String(data?.title||"").trim().slice(0,300);if(!title)throw new HttpError("Provide a property address or portfolio name.");
 const details={};for(const [k,v] of Object.entries(data?.details||{}).slice(0,60))if(typeof v==="string")details[String(k).slice(0,80)]=v.slice(0,4000);
 if(role==="buyer")return {title,auctionId:String(data.auctionId||"").slice(0,100),proposedOffer:String(data.proposedOffer||"").slice(0,30),details};
 const minimum=C.money(data.minimum);if(minimum<1||minimum>999999999000)throw new HttpError("Enter a valid seller minimum.");const days=Number(data.days);if(![1,21].includes(days))throw new HttpError("Choose 1 or 21 days.");
 const kind=data.kind==="portfolio"?"portfolio":"property";
 const portfolio=kind==="portfolio"?C.normalizePortfolio(C.portfolioMatrix(Array.isArray(data.portfolio)?data.portfolio:[])):[];
 if(kind==="portfolio"&&!portfolio.length)throw new HttpError("Upload at least one property.");
 return {title,minimum,days,kind,portfolio,details,draftId:crypto.randomUUID()};
}
class Exchange{
 constructor(ctx,env){this.ctx=ctx;this.env=env;}
 async fetch(request){return this.ctx.blockConcurrencyWhile(async()=>{try{return await this.route(request);}catch(e){return json({error:e.status?e.message:e instanceof Error&&!(e instanceof TypeError)?e.message:"The service could not complete this request."},e.status||400);}});}
 async account(request,required=true){const token=(request.headers.get("Authorization")||"").replace(/^Bearer /,""),id=token.split(".")[0];if(!token||!id){if(!required)return null;throw new HttpError("Complete your participant registration first.",401);}
 const a=await this.ctx.storage.get("account:"+id);if(!a||a.expiresAt<Date.now()||!constantEqual(a.tokenHash,await sha(token))){if(!required)return null;throw new HttpError("Your account session has expired. Submit your information again.",401);}return a;}
 publicAccount(a){return {id:a.id,role:a.role,name:a.name,creditCents:a.creditCents,connectedTest:!this.env.STRIPE_SECRET_KEY?.startsWith("sk_live_")};}
 async rate(key,limit,windowMs=3600000){const k="rate:"+await sha(key),now=Date.now(),r=await this.ctx.storage.get(k)||{start:now,count:0};if(now-r.start>=windowMs){r.start=now;r.count=0;}r.count++;if(r.count>limit)throw new HttpError("Too many attempts. Please try again later.",429);await this.ctx.storage.put(k,r);}
 async allAuctions(){return [...(await this.ctx.storage.list({prefix:"auction:"})).values()];}
 async schedule(){const active=(await this.allAuctions()).filter(a=>a.status==="active");if(active.length)await this.ctx.storage.setAlarm(Math.max(Date.now()+1000,Math.min(...active.map(a=>a.endsAt))));else await this.ctx.storage.deleteAlarm();}
 async settle(){
 for(const a of await this.allAuctions()){if(a.status!=="active"||Date.now()<a.endsAt)continue;C.closeAuction(a);await this.ctx.storage.put("auction:"+a.id,a);
 const ids=new Set([a.sellerId,...a.bids.map(b=>b.buyerId)]);for(const id of ids)await this.ctx.storage.put("notice:"+id+":"+a.id,{auctionId:a.id,title:a.title,closedAt:a.closedAt,outcome:id===a.sellerId?"seller-result":C.outcome(a,id),...(id===a.sellerId?{highest:C.highest(a)?.amount||0}:{}),reserveMet:!!a.winnerId});}
 await this.schedule();
 }
 async alarm(){await this.ctx.blockConcurrencyWhile(()=>this.settle());}
 async credit(session){
 const id=session.metadata?.mreo_account_id,a=await this.ctx.storage.get("account:"+id);if(!a)throw new HttpError("Unknown payment account.");
 if(a.revokedAt)throw new HttpError("This payment was refunded or disputed. Contact MREO before participating.");
 const isLive=this.env.STRIPE_SECRET_KEY?.startsWith("sk_live_");
 if(session.id!==a.checkoutSession||session.payment_status!=="paid"||session.currency!=="usd"||session.amount_total!==100||session.livemode!==isLive||!session.customer)throw new HttpError("The $1 payment has not been verified.",409);
 if(a.creditCents<100){a.creditCents=100;a.customerId=session.customer;a.paymentIntent=session.payment_intent;a.paidAt=Date.now();await this.ctx.storage.put("account:"+a.id,a);await this.ctx.storage.put("ledger:"+session.id,{accountId:a.id,amountCents:100,currency:"usd",kind:"participation",createdAt:Date.now()});}
 return a;
 }
 async webhook(request){
 const raw=await limitedText(request);await verifyStripeSignature(raw,request.headers.get("Stripe-Signature"),this.env.STRIPE_WEBHOOK_SECRET);
 let event;try{event=JSON.parse(raw);}catch{throw new HttpError("Invalid webhook.");}
 if(await this.ctx.storage.get("event:"+event.id))return json({received:true});
 if(["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(event.type)){
 const s=event.data.object;if(s.metadata?.mreo_account_id&&s.payment_status==="paid")await this.credit(await stripe(this.env,"/checkout/sessions/"+encodeURIComponent(s.id)));
 }
 if(["charge.refunded","charge.dispute.created"].includes(event.type)){
 const obj=event.data.object;let pi=obj.payment_intent;if(!pi&&obj.charge){const charge=await stripe(this.env,"/charges/"+encodeURIComponent(obj.charge));pi=charge.payment_intent;}
 if(pi){const intent=await stripe(this.env,"/payment_intents/"+encodeURIComponent(pi));const id=intent.metadata?.mreo_account_id;if(id){const a=await this.ctx.storage.get("account:"+id);if(a&&a.paymentIntent===pi){a.creditCents=0;a.revokedAt=Date.now();await this.ctx.storage.put("account:"+id,a);}}}
 }
 await this.ctx.storage.put("event:"+event.id,{at:Date.now()});return json({received:true});
 }
 async route(request){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(path==="/webhook"&&method==="POST")return this.webhook(request);
 if(path==="/config"&&method==="GET")return json({connected:true,testPayments:!this.env.STRIPE_SECRET_KEY?.startsWith("sk_live_"),defaultDays:this.env.STRIPE_SECRET_KEY?.startsWith("sk_live_")?21:1});
 if(path==="/register"&&method==="POST"){
 await this.rate("registration:"+request.headers.get("CF-Connecting-IP"),20);
 const data=await bodyJSON(request),role=data.role;if(!["buyer","seller"].includes(role))throw new HttpError("Invalid role.");
 const details=validDetails(data.details),submission=validSubmission(role,data.submission),id=crypto.randomUUID(),token=id+"."+hex(crypto.getRandomValues(new Uint8Array(32)));
 const a={id,tokenHash:await sha(token),role,...details,submission,creditCents:0,createdAt:Date.now(),expiresAt:Date.now()+30*C.DAY};
 await this.ctx.storage.put("account:"+id,a);return json({...this.publicAccount(a),token},201);
 }
 if(path==="/submission"&&method==="POST"){
 const a=await this.account(request),data=await bodyJSON(request);Object.assign(a,validDetails(data.details));a.submission=validSubmission(a.role,data.submission);await this.ctx.storage.put("account:"+a.id,a);return json(this.publicAccount(a));
 }
 if(path==="/me"&&method==="GET")return json(this.publicAccount(await this.account(request)));
 if(path==="/checkout"&&method==="POST"){
 const a=await this.account(request),data=await bodyJSON(request);if(a.creditCents>=100)return json({paid:true});if(a.revokedAt)throw new HttpError("Contact MREO about the refunded or disputed payment.");
 if(data.saveConsent!==true)throw new HttpError("Consent is required to save payment credentials.");await this.rate("checkout:"+a.id,15);
 if(a.checkoutSession){const previous=await stripe(this.env,"/checkout/sessions/"+encodeURIComponent(a.checkoutSession));if(previous.payment_status==="paid"){await this.credit(previous);return json({paid:true});}if(previous.status==="open"&&previous.url)return json({url:previous.url});}
 const base=siteURL(this.env),session=await stripe(this.env,"/checkout/sessions",{
 mode:"payment","payment_method_types[0]":"card","customer_creation":"always",customer_email:a.email,
 "line_items[0][price_data][currency]":"usd","line_items[0][price_data][unit_amount]":"100","line_items[0][price_data][product_data][name]":"MREO $1 participation credit","line_items[0][quantity]":"1",
 "payment_intent_data[setup_future_usage]":"on_session",
 "payment_intent_data[metadata][mreo_account_id]":a.id,"metadata[mreo_account_id]":a.id,"metadata[role]":a.role,
 "custom_text[submit][message]":"Pay $1 for MREO participation access. Your payment method is saved with Stripe for future payments you approve. The seller success fee is separate and applies only at a completed sale.",
 success_url:base+"/payment.html?role="+a.role+"&session_id={CHECKOUT_SESSION_ID}",cancel_url:base+"/payment.html?role="+a.role+"&cancelled=1"
 },"mreo-participation-"+a.id+"-"+(a.checkoutSession||"first"));
 a.checkoutSession=session.id;a.saveConsentAt=Date.now();await this.ctx.storage.put("account:"+a.id,a);return json({url:session.url});
 }
 if(path==="/confirm"&&method==="POST"){
 const a=await this.account(request),data=await bodyJSON(request);if(data.sessionId!==a.checkoutSession)throw new HttpError("That payment belongs to a different session.",403);
 const paid=await this.credit(await stripe(this.env,"/checkout/sessions/"+encodeURIComponent(a.checkoutSession)));return json(this.publicAccount(paid));
 }
 await this.settle();
 if(path==="/activate"&&method==="POST"){
 const a=await this.account(request);if(a.creditCents<100)throw new HttpError("A verified $1 participation credit is required.",403);
 if(a.role==="buyer"){const auctionId=a.submission.auctionId;return json({auctionId:auctionId&&await this.ctx.storage.get("auction:"+auctionId)?auctionId:null});}
 if(a.submission.auctionId)return json({auctionId:a.submission.auctionId});
 const draft=a.submission;if(this.env.STRIPE_SECRET_KEY?.startsWith("sk_live_")&&draft.days!==21)throw new HttpError("Use the 21-day standard duration for live auctions.");
 const id="auction-"+draft.draftId,auction=C.createAuction({id,title:draft.title,sellerId:a.id,minimum:draft.minimum,days:draft.days,kind:draft.kind,demo:false});
 auction.example=false;auction.portfolioCount=draft.portfolio.length;
 await this.ctx.storage.put("auction:"+id,auction);if(draft.portfolio.length)await this.ctx.storage.put("portfolio:"+id,draft.portfolio);
 a.submission.auctionId=id;await this.ctx.storage.put("account:"+a.id,a);await this.schedule();return json({auctionId:id},201);
 }
 if(path==="/auctions"&&method==="GET")return json({auctions:(await this.allAuctions()).map(({id,title,kind,reserve,portfolioCount,status,endsAt,example})=>({id,title,kind,reserve,portfolioCount,status,endsAt,example}))});
 if(path==="/notifications"&&method==="GET"){
 const account=await this.account(request),notices=[...(await this.ctx.storage.list({prefix:"notice:"+account.id+":"})).values()];
 // Also redact highest amounts from notifications saved before blind bidding.
 const notifications=await Promise.all(notices.map(async notice=>{const auction=await this.ctx.storage.get("auction:"+notice.auctionId);const {highest,...privateResult}=notice;return auction?.sellerId===account.id?notice:privateResult;}));
 return json({notifications});
 }
 const match=path.match(/^\/auctions\/([a-zA-Z0-9-]+)(\/bids)?$/);
 if(match){const a=await this.ctx.storage.get("auction:"+match[1]);if(!a)throw new HttpError("Auction not found.",404);
 if(match[2]&&method==="POST"){
 const account=await this.account(request);if(account.role!=="buyer"||account.creditCents<100)throw new HttpError("Verified buyer participation is required.",403);
 const data=await bodyJSON(request);if(a.bids.length>=10000)throw new HttpError("This auction has reached its bid limit.");
 C.placeBid(a,{buyerId:account.id,label:"Buyer "+account.id.slice(0,8),amount:data.amount,paid:true,id:crypto.randomUUID()});await this.ctx.storage.put("auction:"+a.id,a);return json({ok:true},201);
 }
 if(!match[2]&&method==="GET"){
 const account=await this.account(request,false),isSeller=account?.id===a.sellerId;
 if(url.searchParams.get("view")==="seller"&&!isSeller)throw new HttpError("Use the listing seller’s account to see all bids and proceeds.",403);
 const now=Date.now();return json({auction:{...C.auctionForViewer(a,account?.id,url.searchParams.get("view"),now),portfolio:await this.ctx.storage.get("portfolio:"+a.id)||[]},account:account?this.publicAccount(account):null,isSeller,serverNow:now});
 }}
 throw new HttpError("Route not found.",404);
 }
}
async function workerFetch(request,env){
 try{
 const origin=request.headers.get("Origin"),allowed=new URL(siteURL(env)).origin,url=new URL(request.url);
 if(origin&&origin!==allowed)return json({error:"Origin not allowed."},403);
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":allowed,"Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Max-Age":"3600","Vary":"Origin"}});
 if(request.method==="POST"&&url.pathname!=="/webhook"&&origin!==allowed)return json({error:"An approved site origin is required."},403);
 const id=env.EXCHANGE.idFromName("mreo-exchange-v1"),response=await env.EXCHANGE.get(id).fetch(request),headers=new Headers(response.headers);headers.set("Access-Control-Allow-Origin",allowed);headers.set("Vary","Origin");headers.set("X-Content-Type-Options","nosniff");
 return new Response(response.body,{status:response.status,headers});
 }catch(e){return json({error:e.status?e.message:"The service is not configured."},e.status||503);}
}

export { Exchange, verifyStripeSignature, validSubmission };
export default { fetch: workerFetch };

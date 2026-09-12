(function serviceModule(){
"use strict";
const C=globalThis.MreoCore,config=globalThis.MREO_CONFIG||{mode:"demo"};
const demo=config.mode!=="connected";
const root=location.pathname.slice(0,location.pathname.lastIndexOf("/")+1);
const key="mreo:v3:"+root;
const sessionKey=role=>key+":"+(demo?"demo":"connected:"+config.apiBase)+":"+role;
const currentRole=()=>sessionStorage.getItem(key+":role")||"buyer";
const setRole=role=>sessionStorage.setItem(key+":role",role);
function read(){const s=localStorage.getItem(key);if(!s)return {accounts:{},auctions:{}};try{const d=JSON.parse(s);if(!d.accounts||!d.auctions)throw Error();return d;}catch{throw Error("Your saved test data could not be read. Use Reset test data on the auction page.");}}
function write(s){try{const value=JSON.stringify(s);if(localStorage.getItem(key)!==value)localStorage.setItem(key,value);}catch{throw Error("Browser storage is full or unavailable. Download your portfolio, then clear old test data or use another browser.");}}
function session(role=currentRole()){try{return JSON.parse(sessionStorage.getItem(sessionKey(role))||"null");}catch{return null;}}
function keep(role,account){sessionStorage.setItem(sessionKey(role),JSON.stringify(account));setRole(role);}
function clear(){localStorage.removeItem(key);for(const role of ["buyer","seller"])sessionStorage.removeItem(sessionKey(role));}
const uid=prefix=>prefix+"-"+crypto.randomUUID();
async function api(path,options={},role=currentRole()){
 if(!config.apiBase||!/^https:\/\//.test(config.apiBase))throw Error("The payment and auction service is not connected.");
 const token=session(role)?.token;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{const r=await fetch(config.apiBase.replace(/\/$/,"")+path,{...options,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{}),...options.headers},signal:controller.signal});const data=await r.json();if(!r.ok)throw Error(data.error||"The service could not complete that request.");return data;}catch(e){if(e.name==="AbortError")throw Error("The service took too long to respond. Please try again.");throw e;}finally{clearTimeout(timer);}
}
async function init(){
 if(!demo){const status=await api("/config");document.querySelectorAll("[data-mode-label]").forEach(el=>{el.textContent=status.testPayments?"Connected test mode · Stripe test payments · No real money":"Connected auctions · Payments verified through Stripe";});return;}
 const s=read();if(s.auctions["demo-property"])return;
 const response=await fetch("data/reo-sample.json");if(!response.ok)throw Error("The example portfolio could not be loaded.");const rows=await response.json();
 for(const [id,name,role] of [["test-buyer-a","Test Buyer A","buyer"],["test-buyer-b","Test Buyer B","buyer"],["test-buyer-c","Test Buyer C","buyer"],["test-seller","Test Seller","seller"]])s.accounts[id]={id,name,role,creditCents:100,test:true};
 const total=C.portfolioTotals(rows),now=Date.now()-31000;
 const examples=[
 C.createAuction({id:"demo-property",title:"4218 Maple Ridge Drive, Dallas, TX 75229",sellerId:"test-seller",minimum:350000,now,demo:true}),
 C.createAuction({id:"demo-portfolio",title:"Illustrative REO portfolio · 150 properties",sellerId:"test-seller",minimum:Math.round(total.price)-C.FEE,kind:"portfolio",portfolio:rows,now,demo:true}),
 C.createAuction({id:"video-property",title:"Featured video property",sellerId:"test-seller",minimum:7499000,now,demo:true})
 ];for(const a of examples){a.example=true;C.seedDemo(a,Date.now());s.auctions[a.id]=a;}write(s);
}
async function register(role,details,submission){
 if(!["buyer","seller"].includes(role))throw Error("Choose a buyer or seller account.");
 setRole(role);
 if(!demo){
 const existing=session(role);
 if(existing){const result=await api("/submission",{method:"POST",body:JSON.stringify({details,submission})},role);keep(role,{...existing,...result});return result;}
 const result=await api("/register",{method:"POST",body:JSON.stringify({role,details,submission})},role);keep(role,result);return result;
 }
 const s=read(),old=session(role),id=old?.id||uid(role);
 const account={...(s.accounts[id]||{}),id,role,name:details.name,email:details.email,creditCents:s.accounts[id]?.creditCents||0,submission:{...submission,draftId:uid("draft")}};
 s.accounts[id]=account;write(s);keep(role,{id,role});return account;
}
async function me(role=currentRole()){
 if(!demo){if(!session(role))return null;return api("/me",{},role);}
 const id=session(role)?.id;return id?read().accounts[id]||null:null;
}
async function checkout(role,consent){
 if(!consent)throw Error("Please confirm the payment and credential-saving terms.");
 if(!demo)return api("/checkout",{method:"POST",body:JSON.stringify({saveConsent:true})},role);
 const s=read(),id=session(role)?.id,a=s.accounts[id];if(!a)throw Error("Submit your information first.");
 a.creditCents=100;a.test=true;write(s);return {paid:true};
}
async function confirm(role,id){
 if(demo)return me(role);
 return api("/confirm",{method:"POST",body:JSON.stringify({sessionId:id})},role);
}
async function activate(role){
 if(!demo)return api("/activate",{method:"POST",body:"{}"},role);
 const s=read(),a=s.accounts[session(role)?.id];if(!a||a.creditCents<100)throw Error("Complete the $1 participation step.");
 if(role==="buyer")return {auctionId:a.submission?.auctionId||null};
 if(a.submission.auctionId)return {auctionId:a.submission.auctionId};
 const draft=a.submission,id=uid("auction");
 const auction=C.createAuction({id,title:draft.title,sellerId:a.id,minimum:draft.minimum,days:draft.days,kind:draft.kind,portfolio:draft.portfolio||[],demo:true});
 auction.example=false;s.auctions[id]=auction;a.submission.auctionId=id;write(s);return {auctionId:id};
}
async function list(){
 if(!demo)return (await api("/auctions")).auctions;
 const s=read();for(const a of Object.values(s.auctions))C.seedDemo(a);write(s);return Object.values(s.auctions);
}
async function auction(id,view="buyer",actor){
 if(!demo)return api("/auctions/"+encodeURIComponent(id)+"?view="+encodeURIComponent(view),{},view);
 const s=read(),a=s.auctions[id];if(!a)throw Error("This auction was not found. Choose another listing.");
 C.seedDemo(a);write(s);
 const account=actor?s.accounts[actor]:s.accounts[session(view)?.id];
 return {auction:a,account:account||null,isSeller:account?.id===a.sellerId,serverNow:Date.now()};
}
async function bid(id,amount,actor){
 if(!demo)return api("/auctions/"+encodeURIComponent(id)+"/bids",{method:"POST",body:JSON.stringify({amount})},"buyer");
 const s=read(),a=s.auctions[id],account=s.accounts[actor||session("buyer")?.id];if(!a)throw Error("Auction not found.");C.seedDemo(a);
 C.placeBid(a,{amount,buyerId:account?.id,label:account?.name,paid:account?.creditCents>=100});write(s);return {ok:true};
}
async function finish(id){if(!demo)throw Error("Test controls are unavailable.");const s=read(),a=s.auctions[id];if(!a)throw Error("Auction not found.");C.seedDemo(a,a.endsAt-1);const now=Date.now();for(const b of a.bids)b.at=Math.min(b.at,now);a.endsAt=now;C.closeAuction(a);write(s);}
async function restart(id){if(!demo)throw Error("Test controls are unavailable.");const s=read(),a=s.auctions[id];if(!a)throw Error("Auction not found.");const fresh=C.createAuction({...a,now:Date.now()-31000});fresh.example=a.example;s.auctions[id]=C.seedDemo(fresh);write(s);}
async function completeSale(id){if(!demo)throw Error("Only test closing can be simulated here.");const s=read(),a=s.auctions[id];C.closeAuction(a);if(!a.winnerId)throw Error("There is no qualifying winning bid.");a.saleCompleted=true;write(s);}
globalThis.MreoService={demo,key,init,register,me,checkout,confirm,activate,list,auction,bid,finish,restart,completeSale,session,currentRole,setRole,clear};
})();

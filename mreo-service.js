(function serviceModule(){
"use strict";
const C=globalThis.MreoCore,config=globalThis.MREO_CONFIG||{mode:"demo"};
const demo=config.mode!=="connected";
const root=location.pathname.slice(0,location.pathname.lastIndexOf("/")+1);
const key="mreo:v3:"+root;
const visibleAuction=a=>!!a&&!a.hidden&&a.id!=="video-property";
const sessionKey=role=>key+":"+(demo?"demo":"connected:"+config.apiBase)+":"+role;
const currentRole=()=>sessionStorage.getItem(key+":role")||"buyer";
const setRole=role=>sessionStorage.setItem(key+":role",role);
function read(){const s=localStorage.getItem(key);if(!s)return {accounts:{},auctions:{}};try{const d=JSON.parse(s);if(!d.accounts||!d.auctions)throw Error();return d;}catch{throw Error("Your saved test data could not be read. Use Reset test data on the auction page.");}}
function write(s){try{const value=JSON.stringify(s);if(localStorage.getItem(key)!==value)localStorage.setItem(key,value);}catch{throw Error("Browser storage is full or unavailable. Download your portfolio, then clear old test data or use another browser.");}}
function session(role=currentRole()){try{return JSON.parse(sessionStorage.getItem(sessionKey(role))||"null");}catch{return null;}}
function keep(role,account){sessionStorage.setItem(sessionKey(role),JSON.stringify(account));setRole(role);}
function demoAccount(state,auction,role,actor){
 // Test Seller previews the owner of the selected listing, including user-created listings.
 const id=actor==="test-seller"?auction.sellerId:actor||session(role)?.id;
 return state.accounts[id]||null;
}
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
 const s=read();if(s.exampleCatalogVersion>=3)return;
 let rows=[];
 if(!s.auctions["demo-portfolio"]){
  const response=await fetch("data/reo-sample.json");if(!response.ok)throw Error("The example portfolio could not be loaded.");rows=await response.json();
 }
 for(const [id,name,role] of [["test-buyer-a","Test Buyer A","buyer"],["test-buyer-b","Test Buyer B","buyer"],["test-buyer-c","Test Buyer C","buyer"],["test-seller","Test Seller","seller"]]){
  if(!s.accounts[id])s.accounts[id]={id,name,role,creditCents:100,test:true};
 }
 const total=C.portfolioTotals(rows),now=Date.now()-31000;
 const examples=[
 {"id":"demo-property","title":"4218 Maple Ridge Drive, Dallas, TX 75229","minimum":350000},
 {id:"demo-portfolio",title:"Illustrative REO portfolio · 150 properties",minimum:Math.round(total.price)-C.FEE,kind:"portfolio",portfolio:rows},
 {"id":"demo-fort-worth","title":"7812 Oak Hollow Lane, Fort Worth, TX 76137","minimum":318000},
 {"id":"demo-plano","title":"2605 Preston Meadow Court, Plano, TX 75093","minimum":547000},
 {"id":"demo-irving","title":"1147 Riverside Terrace, Irving, TX 75062","minimum":428000},
 {"id":"demo-garland","title":"3319 Meadowcrest Avenue, Garland, TX 75043","minimum":273000},
 {"id":"demo-frisco","title":"9014 Silver Creek Way, Frisco, TX 75035","minimum":688000},
 {"id":"demo-richardson","title":"1420 Northgate Row, Richardson, TX 75080","minimum":397000},
 {"id":"demo-arlington","title":"6104 Parkstone Drive, Arlington, TX 76017","minimum":336000},
 {"id":"demo-mckinney","title":"7214 Willow Bend Court, McKinney, TX 75071","minimum":614000},
 {"id":"demo-mesquite","title":"1827 Creekside Circle, Mesquite, TX 75149","minimum":247000},
 {"id":"demo-carrollton","title":"3042 Stonebrook Lane, Carrollton, TX 75007","minimum":461000},
 {"id":"demo-southlake","title":"1850 Cedar Ridge Boulevard, Southlake, TX 76092","minimum":1124000},
 {"id":"demo-denton","title":"940 Hickory Grove Road, Denton, TX 76209","minimum":354000},
 {"id":"demo-addison","title":"5016 Meridian Place, Addison, TX 75001","minimum":448000},
 {"id":"demo-lewisville","title":"2317 Lakeview Terrace, Lewisville, TX 75067","minimum":414000},
 {"id":"demo-grapevine","title":"805 Vineyard Crossing, Grapevine, TX 76051","minimum":578000},
 {"id":"demo-dallas-condo","title":"3921 Travis Street Unit 204, Dallas, TX 75204","minimum":398000},
 {"id":"demo-allen","title":"1709 Brookfield Drive, Allen, TX 75002","minimum":514000},
 {"id":"demo-colleyville","title":"6408 Heritage Oaks Drive, Colleyville, TX 76034","minimum":874000},
 {"id":"demo-grand-prairie","title":"2906 Prairie Creek Road, Grand Prairie, TX 75052","minimum":288000}
 ];
 for(const example of examples){
  if(s.auctions[example.id])continue;
  const a=C.createAuction({...example,sellerId:"test-seller",now,demo:true});
  a.example=true;C.seedDemo(a,Date.now());s.auctions[a.id]=a;
 }
 // Retain any saved bids on the retired example without offering it for auction.
 if(s.auctions["video-property"])s.auctions["video-property"].hidden=true;
 s.exampleCatalogVersion=3;write(s);
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
 if(role==="buyer"){
  const id=a.submission?.auctionId;
  if(id)return {auctionId:visibleAuction(s.auctions[id])?id:null};
  // Older buyer links saved only the address. Recover an unambiguous matching auction.
  const matches=Object.values(s.auctions).filter(auction=>visibleAuction(auction)&&auction.title===a.submission?.title);
  return {auctionId:matches.length===1?matches[0].id:null};
 }
 if(a.submission.auctionId)return {auctionId:a.submission.auctionId};
 const draft=a.submission,id=uid("auction");
 const auction=C.createAuction({id,title:draft.title,sellerId:a.id,minimum:draft.minimum,days:draft.days,kind:draft.kind,portfolio:draft.portfolio||[],demo:true});
 auction.example=false;s.auctions[id]=auction;a.submission.auctionId=id;write(s);return {auctionId:id};
}
async function list(){
 if(!demo)return (await api("/auctions")).auctions.filter(visibleAuction);
 const s=read(),auctions=Object.values(s.auctions).filter(visibleAuction);for(const a of auctions)C.seedDemo(a);write(s);
 return auctions.map(({id,title,kind,reserve,portfolio,portfolioCount,status,endsAt,example})=>({id,title,kind,reserve,portfolioCount:portfolioCount??portfolio?.length??0,status,endsAt,example}));
}
async function auction(id,view="buyer",actor){
 if(!demo)return api("/auctions/"+encodeURIComponent(id)+"?view="+encodeURIComponent(view),{},view);
 const s=read(),a=s.auctions[id];if(!visibleAuction(a))throw Error("This auction was not found. Choose another listing.");
 C.seedDemo(a);write(s);
 const account=demoAccount(s,a,view,actor);
 const now=Date.now();return {auction:C.auctionForViewer(a,account?.id,view,now),account:account||null,isSeller:account?.id===a.sellerId,serverNow:now};
}
async function bid(id,amount,actor){
 if(!demo)return api("/auctions/"+encodeURIComponent(id)+"/bids",{method:"POST",body:JSON.stringify({amount})},"buyer");
 const s=read(),a=s.auctions[id];if(!visibleAuction(a))throw Error("Auction not found.");const account=demoAccount(s,a,"buyer",actor);C.seedDemo(a);
 C.placeBid(a,{amount,buyerId:account?.id,label:account?.name,paid:account?.creditCents>=100});write(s);return {ok:true};
}
async function finish(id){if(!demo)throw Error("Test controls are unavailable.");const s=read(),a=s.auctions[id];if(!a)throw Error("Auction not found.");C.seedDemo(a,a.endsAt-1);const now=Date.now();for(const b of a.bids)b.at=Math.min(b.at,now);a.endsAt=now;C.closeAuction(a);write(s);}
async function restart(id){if(!demo)throw Error("Test controls are unavailable.");const s=read(),a=s.auctions[id];if(!a)throw Error("Auction not found.");const fresh=C.createAuction({...a,now:Date.now()-31000});fresh.example=a.example;s.auctions[id]=C.seedDemo(fresh);write(s);}
async function completeSale(id){if(!demo)throw Error("Only test closing can be simulated here.");const s=read(),a=s.auctions[id];C.closeAuction(a);if(!a.winnerId)throw Error("There is no qualifying winning bid.");a.saleCompleted=true;write(s);}
globalThis.MreoService={demo,key,init,register,me,checkout,confirm,activate,list,auction,bid,finish,restart,completeSale,session,currentRole,setRole,clear};
})();

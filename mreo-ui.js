(function uiModule(){
"use strict";
const C=globalThis.MreoCore,S=globalThis.MreoService,$=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const cash=v=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(v||0);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let uploadedRows=[],uploadPromise=null,xlsxPromise=null,readyPromise=Promise.resolve();
const field=id=>$(id)?.value.trim()||"";
function message(id,text,error=false){const el=$(id);if(!el)return;el.textContent=text;el.hidden=false;el.classList.toggle("error-message",error);el.classList.toggle("success-message",!error);}
async function busy(button,fn){if(button.disabled)return;button.disabled=true;const original=button.textContent;button.textContent="Please wait…";try{return await fn();}finally{button.disabled=false;button.textContent=original;}}
function loadXLSX(){if(window.XLSX)return Promise.resolve(window.XLSX);if(xlsxPromise)return xlsxPromise;xlsxPromise=new Promise((resolve,reject)=>{const script=document.createElement("script");script.src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";const timeout=setTimeout(()=>reject(Error("The Excel reader could not load. Try again or upload CSV.")),15000);script.onload=()=>{clearTimeout(timeout);window.XLSX?resolve(window.XLSX):reject(Error("Excel reader unavailable. Upload CSV instead."));};script.onerror=()=>{clearTimeout(timeout);reject(Error("The Excel reader could not load. Upload CSV instead."));};document.head.appendChild(script);}).catch(e=>{xlsxPromise=null;throw e;});return xlsxPromise;}
function matrixTable(matrix,limit=5){return '<div class="table-scroll"><table class="data-table"><thead><tr>'+matrix[0].map(h=>"<th>"+esc(h)+"</th>").join("")+"</tr></thead><tbody>"+matrix.slice(1,limit+1).map(row=>"<tr>"+row.map(cell=>"<td>"+esc(cell)+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>";}
function setupSeller(){
 if(!$("seller-form"))return;
 const toggle=()=>{const portfolio=$("sell-kind-portfolio").checked;$("portfolio-fields").hidden=!portfolio;$("portfolio-fields").disabled=!portfolio;$("single-fields").hidden=portfolio;$("single-fields").disabled=portfolio;$("single-search-panel").hidden=portfolio;document.querySelectorAll("#single-search-panel input, #single-search-panel button").forEach(el=>el.disabled=portfolio);$("property-information-heading").textContent=portfolio?"Portfolio information":"Property information";$("open-seller-contract").hidden=portfolio;};
 for(const id of ["sell-kind-property","sell-kind-portfolio"])$(id).addEventListener("change",toggle);
 if(params.get("kind")==="portfolio")$("sell-kind-portfolio").checked=true;toggle();
 const fees=()=>{try{const value=C.money(field("seller-minimum"));$("seller-fee-preview").textContent="Your required bid is "+cash(value+C.FEE)+": "+cash(value)+" to you after the "+cash(C.FEE)+" MREO fee, before other closing costs. The fee is due only if the sale closes.";}catch{$("seller-fee-preview").textContent="Set the minimum you want to receive after the MREO fee, before other closing costs.";}};$("seller-minimum").addEventListener("input",fees);fees();
 let version=0;
 $("portfolio-file").addEventListener("change",()=>{
 const v=++version,input=$("portfolio-file"),file=input.files?.[0];uploadedRows=[];input.setCustomValidity("");$("portfolio-preview").innerHTML="";
 if(!file){uploadPromise=null;return;}
 uploadPromise=(async()=>{
 input.setCustomValidity("Wait for the spreadsheet to finish processing.");
 if(file.size>5*1024*1024)throw Error("Choose a spreadsheet smaller than 5 MB.");
 let matrix;
 if(/\.csv$/i.test(file.name))matrix=C.parseCSV(await file.text());
 else if(/\.(xlsx|xls)$/i.test(file.name)){const XLSX=await loadXLSX();const wb=XLSX.read(await file.arrayBuffer(),{type:"array",cellFormula:false});matrix=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:"",raw:true});}
 else throw Error("Choose an .xlsx, .xls, or .csv spreadsheet.");
 const rows=C.normalizePortfolio(matrix);if(v!==version)return;
 if(!rows.length)throw Error("Add at least one property.");uploadedRows=rows;input.setCustomValidity("");
 const total=C.portfolioTotals(rows);
 $("portfolio-preview").innerHTML="<p><strong>"+rows.length+" properties ready.</strong> Reference value: "+cash(total.value)+". Example price at 7%: "+cash(total.price)+".</p>"+matrixTable(C.portfolioMatrix(rows).map(row=>row.slice(0,12)))+'<p class="field-note">Preview shows the first five properties. Every valid row is included in the portfolio. Set your own seller minimum below.</p>';
 message("portfolio-upload-message",rows.length+" properties imported successfully.");
 })().catch(e=>{if(v===version){uploadedRows=[];input.setCustomValidity(e.message);message("portfolio-upload-message",e.message,true);}});});
}
async function submitSeller(){
 await readyPromise;
 if(uploadPromise)await uploadPromise;
 const form=$("seller-form");if(!form.reportValidity())return;
 const portfolio=$("sell-kind-portfolio").checked;
 if(portfolio&&!uploadedRows.length)throw Error("Upload and review your portfolio spreadsheet first.");
 const title=portfolio?field("portfolio-title"):[field("property-address"),field("property-city"),field("property-state")+" "+field("property-zip")].filter(Boolean).join(", ");
 const submission={title,kind:portfolio?"portfolio":"property",minimum:C.money(field("seller-minimum")),days:Number(field("auction-days")),portfolio:portfolio?uploadedRows:[],details:Object.fromEntries([...new FormData(form)].filter(([,v])=>typeof v==="string"))};
 await S.register("seller",{name:field("seller-name"),email:field("seller-email")},submission);
 location.href="payment.html?role=seller";
}
async function submitBuyer(){
 await readyPromise;
 const form=$("buyer-form");if(!form.reportValidity())return;
 await S.register("buyer",{name:field("buyer-name"),email:field("buyer-email")},{title:field("buyer-offer-address"),auctionId:params.get("auction")||"",proposedOffer:field("buyer-offer-amount"),details:Object.fromEntries([...new FormData(form)].filter(([,v])=>typeof v==="string"))});
 location.href="payment.html?role=buyer";
}
async function payment(){
 if(!$("payment-submit"))return;
 const role=params.get("role")==="seller"?"seller":"buyer";S.setRole(role);$("payment-role").textContent=role==="seller"?"Seller":"Buyer";$("payment-back").href=role+".html";
 if(S.demo){$("payment-intro").textContent="Try the complete participation flow with a $1 test credit."; $("payment-explanation").textContent="This test step does not charge money or collect payment credentials. The connected version uses Stripe checkout to collect $1 and save your payment method."; $("payment-consent-label").textContent="I understand this adds a $1 test credit. No money is charged and no card is saved.";}
 const button=$("payment-submit");
 async function refresh(){
 const a=await S.me(role);if(!a){message("payment-message","Submit your "+role+" information before completing participation.",true);button.disabled=true;button.textContent="Submit your information first";return null;}
 $("payment-account").textContent=a.name;$("payment-credit").textContent="$"+(Number(a.creditCents||0)/100).toFixed(2)+(S.demo?" test":"");
 const paid=a.creditCents>=100;$("payment-consent-row").hidden=paid;button.disabled=false;button.textContent=paid?"Continue to auction →":S.demo?"Complete $1 test step":"Pay $1 securely with Stripe";return a;
 }
 let a=await refresh();
 if(params.get("cancelled"))message("payment-message","Checkout was cancelled. No auction access has been activated.");
 if(params.get("session_id")&&!S.demo){button.disabled=true;message("payment-message","Verifying payment…");try{await S.confirm(role,params.get("session_id"));history.replaceState(null,"","payment.html?role="+role);a=await refresh();message("payment-message",a.creditCents>=100?"Payment verified. Your $1 participation credit is ready.":"Payment is still pending. Refresh shortly to check again.");}catch(e){message("payment-message",e.message,true);await refresh();}}
 button.addEventListener("click",()=>busy(button,async()=>{try{
 a=await S.me(role);if(a.creditCents<100){const r=await S.checkout(role,$("payment-consent").checked);if(!S.demo&&!r.paid){const url=new URL(r.url);if(url.protocol!=="https:"||url.hostname!=="checkout.stripe.com")throw Error("Unexpected checkout address.");location.assign(url.href);return;}a=await S.me(role);$("payment-credit").textContent="$1.00 test";}
 const active=await S.activate(role);
 location.href=active.auctionId?"auction.html?id="+encodeURIComponent(active.auctionId)+"&view="+role:"auction.html?view="+role+"&select=1"+(a.submission?.title?"&address="+encodeURIComponent(a.submission.title):"");
 }catch(e){message("payment-message",e.message,true);}}));
}
async function portfolio(){
 if(!$("portfolio-table-body"))return;
 let rows=[],auction=null;const id=params.get("id");
 try{
 if(id){const result=await S.auction(id);auction=result.auction;rows=auction.portfolio||[];if(!rows.length)throw Error("This listing does not contain a portfolio spreadsheet.");$("portfolio-title").textContent=auction.title;$("portfolio-data-label").textContent=auction.example?"Illustrative REO portfolio · Fictional data":"Seller-provided portfolio data";$("portfolio-source-note").textContent=auction.example?"Fictional example data. This is not an actual bank offer.":"Review the seller-provided information and arrange due diligence before purchasing."; }
 else{const res=await fetch("data/reo-sample.json");if(!res.ok)throw Error("The sample spreadsheet could not be loaded.");rows=await res.json();}
 const total=C.portfolioTotals(rows),listingId=auction?.id||"demo-portfolio";
 $("portfolio-count").textContent=String(rows.length);$("portfolio-value").textContent=cash(total.value);$("portfolio-price").textContent=cash(auction&&!auction.example?auction.reserve:total.price);
 if(auction&&!auction.example){$("portfolio-price-label").textContent="Required portfolio bid";$("portfolio-pricing-note").textContent="Seller minimum plus the $1,000 MREO fee";}
 const title=auction?.title||"Illustrative REO portfolio · 150 properties";
 $("portfolio-interest").href="buyer.html?auction="+encodeURIComponent(listingId)+"&address="+encodeURIComponent(title)+"&price="+Math.round(auction?.reserve||total.price);
 $("portfolio-auction").href="auction.html?id="+encodeURIComponent(listingId);
 if(!S.demo&&!auction){$("portfolio-interest").href="buyer.html?address="+encodeURIComponent(title);$("portfolio-auction").hidden=true;}
 if(auction&&!auction.example){
 $("portfolio-csv").href=URL.createObjectURL(new Blob([C.csv(C.portfolioMatrix(rows))],{type:"text/csv;charset=utf-8"}));$("portfolio-csv").download="MREO-portfolio.csv";
 const dl=$("portfolio-download");dl.removeAttribute("href");dl.removeAttribute("download");dl.setAttribute("role","button");dl.tabIndex=0;dl.textContent="Download Excel · "+rows.length+" properties";
 const download=async e=>{e.preventDefault();try{const X=await loadXLSX(),wb=X.utils.book_new();X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(C.portfolioMatrix(rows)),"Properties");X.writeFile(wb,"MREO-portfolio.xlsx");}catch(err){message("portfolio-message",err.message,true);}};dl.addEventListener("click",download);dl.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" ")download(e);});
 }
 $("portfolio-table-head").innerHTML="<tr>"+C.COLUMNS.map(c=>'<th scope="col">'+esc(c)+"</th>").join("")+"</tr>";
 [...new Set(rows.map(r=>r.condition))].sort().forEach(c=>{const o=document.createElement("option");o.value=c;o.textContent=c;$("portfolio-condition").append(o);});
 const render=()=>{const q=field("portfolio-search").toLowerCase(),condition=field("portfolio-condition"),filtered=rows.filter(r=>(!condition||r.condition===condition)&&(!q||Object.values(r).join(" ").toLowerCase().includes(q)));
 $("portfolio-showing").textContent=filtered.length+" of "+rows.length+" properties · scroll horizontally to see all columns";
 $("portfolio-table-body").innerHTML=C.portfolioMatrix(filtered).slice(1).map(row=>"<tr>"+row.map((v,i)=>"<td>"+esc(i>=11&&i<=17&&i!==16?cash(v):v)+"</td>").join("")+"</tr>").join("")||'<tr><td colspan="19">No properties match your filters.</td></tr>';};
 $("portfolio-search").addEventListener("input",render);$("portfolio-condition").addEventListener("change",render);render();
 }catch(e){message("portfolio-message",e.message,true);}
}
function marketplace(){
 const container=$("new-listings");if(!container)return;
 const kind=container.dataset.listingKind||"property";
 return S.list().then(auctions=>{
  container.innerHTML=auctions.filter(a=>!a.example&&(kind==="portfolio"?a.kind==="portfolio":a.kind!=="portfolio")).map(a=>{
   if(a.kind==="portfolio")return '<a class="portfolio-entry" href="portfolio.html?id='+encodeURIComponent(a.id)+'"><img src="assets/mreo-portfolio.png" alt="MREO Buy Portfolio As Is" width="768" height="512" loading="lazy"><div><p class="section-label">'+(S.demo?"Your test portfolio":"Available portfolio")+'</p><h2>'+esc(a.title)+'</h2><p>'+(a.portfolioCount??a.portfolio?.length??0)+' properties · Required bid '+cash(a.reserve)+'. Review the complete spreadsheet before preparing your interest.</p><span class="text-link">View portfolio spreadsheet →</span></div></a>';
   return '<article class="property-row"><div class="property-thumbnail"><img src="assets/property-placeholder.svg" alt="Property awaiting seller photographs" loading="lazy"></div><div class="property-main-info"><p class="property-location">'+(S.demo?"Your test listing":"Seller listing")+'</p><h2>'+esc(a.title)+'</h2><p>As-is property</p></div><div class="property-facts"><div><span class="property-fact-label">Required bid</span><strong>'+cash(a.reserve)+'</strong></div></div><div class="property-action"><a class="primary-button" href="auction.html?id='+encodeURIComponent(a.id)+'">View auction</a></div></article>';
  }).join("");
 }).catch(e=>message("marketplace-message",e.message,true));
}
async function auctionPage(){
 if(!$("auction-select"))return;
 let id=params.get("id")||"",view=params.get("view")==="seller"?"seller":"buyer",actor="",last=null,clockOffset=0,refreshing=false;
 $("test-controls").hidden=!S.demo;
 const select=$("auction-select");
 let requestedTitle=params.get("address")||"",requireSelection=params.get("select")==="1"||params.has("id")||!!requestedTitle;
 async function loadList(){
 const all=await S.list();
 if(!id&&!params.has("id")&&!params.has("address")&&params.get("select")!=="1"&&view==="buyer"){
  const account=await S.me("buyer"),submission=account?.submission;
  if(submission){
   requestedTitle=submission.title||requestedTitle;
   const matches=submission.auctionId?all.filter(a=>a.id===submission.auctionId):all.filter(a=>a.title===requestedTitle);
   if(matches.length===1)id=matches[0].id;
   else requireSelection=!!requestedTitle||!!submission.auctionId;
  }
 }
 select.innerHTML=all.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.title)+'</option>').join("");
 if(!all.length){id="";last=null;$("auction-content").hidden=true;message("auction-message","No auctions are active yet. Submit a property or portfolio to begin.");select.innerHTML='<option value="">No auctions yet</option>';return false;}
 if(!all.some(a=>a.id===id)){
  if(requireSelection){
   const missing=!!id;id="";last=null;$("auction-content").hidden=true;
   select.insertAdjacentHTML("afterbegin",'<option value="" disabled>'+esc(requestedTitle?requestedTitle+" · No active auction":"Choose a property or portfolio")+'</option>');select.value="";
   message("auction-message",requestedTitle?"No active auction is available for "+requestedTitle+". Choose another property or portfolio to view an auction.":missing?"That auction is unavailable. Choose another property or portfolio.":"Choose the property or portfolio whose auction you want to view.",missing);
   return false;
  }
  id=all[0].id;
 }
 select.value=id;return true;
 }
 function setView(){S.setRole(view);$("view-buyer").setAttribute("aria-pressed",String(view==="buyer"));$("view-seller").setAttribute("aria-pressed",String(view==="seller"));$("buyer-area").hidden=view!=="buyer";$("seller-area").hidden=view!=="seller";$("activity-title").textContent=view==="seller"?"Seller proceeds":"Your participation";}
 const timeText=ms=>{const sec=Math.max(0,Math.ceil(ms/1000)),d=Math.floor(sec/86400),h=Math.floor(sec/3600)%24,m=Math.floor(sec/60)%60,s=sec%60;return (d?d+"d ":"")+[h,m,s].map(n=>String(n).padStart(2,"0")).join(":");};
 function tick(){if(!last)return;const ms=last.auction.endsAt-(Date.now()+clockOffset);$("auction-clock").textContent=ms<=0?"00:00:00":timeText(ms);if(ms<=0){$("bid-form").hidden=true;if(last.auction.status==="active")refresh();}}
 function resultHTML(a,account,isSeller){
 if(a.status!=="closed")return "";
 const top=C.highest(a),o=a.viewerOutcome;
 if(view==="seller"&&isSeller)return '<span class="result-eyebrow">Highest offer at close</span><strong class="seller-winning-price">'+(top?cash(top.amount):"No bids")+'</strong><p>'+(a.winnerId?"Reserve met. Connect with the winning buyer to arrange acceptance and closing.":"No qualifying sale result. "+(top?"The highest bid did not meet your minimum including the MREO fee.":"No buyer placed a bid."))+'</p>';
 if(view==="seller")return '<p>Auction closed. Sign in as the listing seller to review the private result.</p>';
 if(o==="not-participating")return '<span class="signal-light signal-neutral" role="img" aria-label="No bid placed"></span><div><strong>Auction ended</strong><p>You did not place a bid on this listing.</p></div>';
 const win=o==="won";
 return '<span class="signal-light '+(win?"signal-green":"signal-red")+'" role="img" aria-label="'+(win?"Green light: winning bid":"Red light: no winning bid")+'"></span><div><strong>'+(win?"Your bid won":o==="reserve-not-met"?"Reserve not met":"Your bid did not win")+'</strong><p>'+(win?"Your winning bid: "+cash(top.amount)+". Seller acceptance and closing are still required.":o==="reserve-not-met"?"No bid qualified at the seller’s minimum.":"The auction has ended. Other buyers’ bid amounts remain private.")+"</p></div>";
 }
 async function refresh(){
 if(refreshing||!id)return;refreshing=true;
 const requestedId=id,requestedView=view,requestedActor=actor;
 const selectionChanged=()=>requestedId!==id||requestedView!==view||requestedActor!==actor;
 try{
 const loadedAuction=await S.auction(requestedId,requestedView,requestedActor);if(selectionChanged())return;
 last=loadedAuction;const {auction:a,account,isSeller}=last;
 const selectedOption=[...select.options].find(option=>option.value===a.id);if(selectedOption)selectedOption.textContent=a.title;select.value=a.id;clockOffset=(last.serverNow||Date.now())-Date.now();const top=C.highest(a),summary=C.sellerSummary(a);
 $("auction-content").hidden=false;$("auction-title").textContent=a.title;$("auction-kind").textContent=a.kind==="portfolio"?"Portfolio · "+(a.portfolioCount??a.portfolio?.length??0)+" properties":"Property";$("auction-status").textContent=a.status==="active"?"Active":"Closed";$("auction-status").classList.toggle("is-closed",a.status==="closed");
 $("auction-count").textContent=String(a.bidCount??a.bids.length);$("auction-duration").textContent=a.days+"-day "+(a.days===1?"test timing":"standard timing");$("auction-deadline").textContent="Closes "+new Date(a.endsAt).toLocaleString();
 const output=resultHTML(a,account,isSeller),result=$("auction-result");result.hidden=!output;if(result.innerHTML!==output)result.innerHTML=output;
 $("buyer-identity").textContent=account?(account.name+" · "+(S.demo?"test ":"")+"participation credit $"+((account.creditCents||0)/100).toFixed(2)):"Complete buyer interest and the $1 participation step to bid.";
 const eligible=account?.role==="buyer"&&account.creditCents>=100;
 $("bid-form").hidden=!eligible||a.status!=="active";$("bid-register").hidden=!!eligible||a.status!=="active";$("bid-register").href="buyer.html?auction="+encodeURIComponent(a.id)+"&address="+encodeURIComponent(a.title);
 $("buyer-status").textContent=a.status==="active"?(a.viewerOutcome==="submitted"?"Your bid has been received. Your result will be shown when the auction ends.":"Your submitted interest is not automatically placed as a bid."):"";
 $("seller-private").hidden=view!=="seller"||!isSeller;$("seller-access-message").textContent=isSeller?"A winning bid must cover your minimum plus the MREO fee. An auction result does not itself charge the success fee.":"Only the listing seller can view all bids and the seller’s proceeds. "+(S.demo?"Choose Test Seller above to preview this listing’s seller view.":"Use the same browser tab used to submit this listing.");
 if(view==="seller"&&isSeller){$("seller-net-min").textContent=cash(a.minimum);$("seller-reserve").textContent=cash(a.reserve);$("seller-proceeds").textContent=top?cash(summary.proceeds):"—";$("seller-additional").textContent=cash(summary.additional);$("seller-fee-due").textContent=cash(summary.feeDue);$("complete-sale").hidden=!S.demo||!a.winnerId||a.saleCompleted;}
 else{for(const field of ["seller-net-min","seller-reserve","seller-proceeds","seller-additional","seller-fee-due"])$(field).textContent="";$("complete-sale").hidden=true;}
 const bids=view==="seller"&&isSeller?a.bids:a.bids.filter(b=>b.buyerId===account?.id);
 $("bid-history-title").textContent=view==="seller"&&isSeller?"All associated bids":"Your bid history";$("bid-history").innerHTML=[...bids].sort((x,y)=>y.amount-x.amount).map(b=>"<tr><td>"+esc(b.label)+"</td><td>"+cash(b.amount)+"</td><td>"+esc(new Date(b.at).toLocaleTimeString())+"</td></tr>").join("")||'<tr><td colspan="3">'+(view==="seller"&&!isSeller?"Seller access required.":"No bids to display.")+"</td></tr>";
 tick();
 }catch(e){if(selectionChanged())return;last=null;$("auction-content").hidden=true;message("auction-message",e.message,true);}finally{refreshing=false;if(selectionChanged())refresh();}
 }
 for(const role of ["buyer","seller"])$("view-"+role).addEventListener("click",()=>{view=role;last=null;$("auction-content").hidden=true;setView();refresh();});
 select.addEventListener("change",()=>{id=select.value;last=null;$("auction-content").hidden=true;$("auction-message").hidden=true;$("bid-amount").value="";history.replaceState(null,"","auction.html?id="+encodeURIComponent(id)+"&view="+view);refresh();});
 $("test-actor").addEventListener("change",()=>{actor=field("test-actor");last=null;$("auction-content").hidden=true;$("bid-amount").value="";if(actor==="test-seller")view="seller";else if(actor)view="buyer";setView();refresh();});
 $("bid-form").addEventListener("submit",async e=>{e.preventDefault();if(!$("bid-form").reportValidity())return;const button=e.submitter||$("bid-form").querySelector("button");await busy(button,async()=>{try{await S.bid(id,field("bid-amount"),actor);$("bid-consent").checked=false;message("auction-message","Bid placed successfully.");await refresh();}catch(err){message("auction-message",err.message,true);await refresh();}});});
 for(const [button,method,confirmation] of [["finish-auction","finish",false],["restart-auction","restart",true],["complete-sale","completeSale",false]])$(button).addEventListener("click",()=>busy($(button),async()=>{if(confirmation&&!confirm("Restart this test auction and clear its bids?"))return;try{await S[method](id);await refresh();}catch(e){message("auction-message",e.message,true);}}));
 $("reset-demo").addEventListener("click",()=>{if(confirm("Clear all MREO test accounts, uploaded portfolio data, listings, and bids in this browser?")){S.clear();location.href="auction.html";}});
 setView();const hasSelection=await loadList();
 if(S.demo&&!S.session(view)){actor=view==="seller"?"test-seller":"";$("test-actor").value=actor;}
 if(hasSelection)await refresh();setInterval(tick,1000);setInterval(()=>{if(!document.hidden)refresh();},5000);window.addEventListener("storage",e=>{if(e.key===S.key){loadList().then(refresh).catch(err=>message("auction-message",err.message,true));}});document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});
}
function mediaFallbacks(){document.querySelectorAll("[data-video-image]").forEach(img=>{img.addEventListener("error",()=>{const f=document.createElement("span");f.className="video-fallback";f.textContent="Open the property video →";img.replaceWith(f);});});}
async function initialize(){
 document.querySelectorAll("[data-mode-label]").forEach(el=>{el.textContent=S.demo?"Test mode · No real payments or binding bids · 1-day auction timing":"Connected auctions · Payment is verified through Stripe";});
 setupSeller();mediaFallbacks();
 try{readyPromise=S.init();await readyPromise;await Promise.all([payment(),portfolio(),marketplace(),auctionPage()]);}
 catch(e){const ids=["payment-message","portfolio-message","auction-message","seller-message","buyer-message","marketplace-message"];let shown=false;for(const id of ids)if($(id)){message(id,e.message,true);shown=true;}if(!shown){const p=document.createElement("p");p.className="form-message error-message";p.setAttribute("role","alert");p.textContent=e.message;document.querySelector("main")?.prepend(p);}}
}
globalThis.MreoUI={submitSeller,submitBuyer};initialize();
})();

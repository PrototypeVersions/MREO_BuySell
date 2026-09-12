(function coreModule(){
"use strict";
const FEE=1000,DAY=86400000,MAX=1e12;
const money=v=>{const n=Number(String(v??"").replace(/[$,\s]/g,""));if(!Number.isSafeInteger(n)||n<0||n>MAX)throw Error("Enter a whole-dollar amount between $0 and $1 trillion.");return n;};
function createAuction({id,title,sellerId,minimum,days=1,kind="property",portfolio=[],demo=false,now=Date.now()}){
 const net=money(minimum);if(net<1)throw Error("Set a seller minimum greater than zero.");
 if(![1,21].includes(Number(days)))throw Error("Choose a 1-day test or 21-day auction.");
 if(!id||!sellerId||!String(title).trim())throw Error("An auction needs a listing and a seller.");
 return {id,title:String(title).trim().slice(0,300),sellerId,kind,portfolio,minimum:net,reserve:net+FEE,fee:FEE,startsAt:now,endsAt:now+Number(days)*DAY,days:Number(days),bids:[],status:"active",demo:!!demo,seeded:0,closedAt:null,winnerId:null,saleCompleted:false};
}
function highest(a){return [...a.bids].sort((x,y)=>y.amount-x.amount||x.at-y.at||String(x.id).localeCompare(String(y.id)))[0]||null;}
function nextBid(a){return highest(a)?highest(a).amount+100:100;}
function closeAuction(a,now=Date.now()){
 if(a.status==="active"&&now>=a.endsAt){a.status="closed";a.closedAt=a.endsAt;const top=highest(a);a.winnerId=top&&top.amount>=a.reserve?top.buyerId:null;}
 return a;
}
function placeBid(a,{buyerId,label,amount,paid,now=Date.now(),id}){
 closeAuction(a,now);
 if(a.status!=="active")throw Error("This auction has closed.");
 if(now<a.startsAt)throw Error("This auction has not started.");
 if(!paid)throw Error("Complete the $1 participation step before bidding.");
 if(!buyerId||buyerId===a.sellerId)throw Error("Sellers cannot bid on their own listing.");
 const price=money(amount);
 if(price<nextBid(a))throw Error("The next bid must be at least $"+nextBid(a).toLocaleString("en-US")+".");
 const bid={id:id||buyerId+"-"+now,buyerId,label:String(label||"Buyer").slice(0,80),amount:price,at:now};
 a.bids.push(bid);return bid;
}
function seedDemo(a,now=Date.now()){
 if(!a.demo||a.status!=="active")return a;
 const schedule=[{after:5000,id:"test-buyer-a",label:"Test Buyer A",factor:.9},{after:15000,id:"test-buyer-b",label:"Test Buyer B",factor:.98},{after:30000,id:"test-buyer-c",label:"Test Buyer C",factor:1.04}];
 for(let i=a.seeded;i<schedule.length;i++){const s=schedule[i],at=a.startsAt+s.after;if(now<at||at>=a.endsAt)break;a.seeded=i+1;const amount=Math.ceil(a.reserve*s.factor/100)*100;if(amount>=nextBid(a))placeBid(a,{buyerId:s.id,label:s.label,amount,paid:true,now:at,id:a.id+"-seed-"+i});}
 return closeAuction(a,now);
}
function outcome(a,buyerId,now=Date.now()){
 closeAuction(a,now);const top=highest(a),hasBid=a.bids.some(b=>b.buyerId===buyerId);
 if(a.status==="active")return top?.buyerId===buyerId?"leading":hasBid?"outbid":"watching";
 if(!hasBid)return "not-participating";
 return a.winnerId===buyerId?"won":a.winnerId?"lost":"reserve-not-met";
}
function sellerSummary(a){const top=highest(a);return {highest:top?.amount||0,reserveMet:!!top&&top.amount>=a.reserve,proceeds:top?Math.max(0,top.amount-a.fee):0,additional:top?Math.max(0,top.amount-a.fee-a.minimum):0,feeDue:a.saleCompleted&&a.winnerId?a.fee:0};}
function parseCSV(text){
 const rows=[];let row=[],field="",quoted=false;
 const src=String(text).replace(/^\uFEFF/,"");
 for(let i=0;i<src.length;i++){const c=src[i];
 if(c==='"'){if(quoted&&src[i+1]==='"'){field+='"';i++;}else if(quoted)quoted=false;else if(field==="")quoted=true;else throw Error("Malformed CSV quote.");}
 else if(c===","&&!quoted){row.push(field);field="";}
 else if((c==="\n"||c==="\r")&&!quoted){if(c==="\r"&&src[i+1]==="\n")i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field="";}
 else field+=c;
 }
 if(quoted)throw Error("The CSV has an unclosed quoted field.");
 row.push(field);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
const COLUMNS=["Asset ID","Address","City","State","ZIP","Property Type","Beds","Baths","Square Feet","Occupancy","Condition","Reference Value","Loan Balance","Repair Estimate","Annual Taxes","HOA Monthly","Title Status","7% Allocation","Notes"];
function normalizePortfolio(matrix){
 if(!Array.isArray(matrix)||matrix.length<2)throw Error("The spreadsheet needs a header row and at least one property.");
 const key=s=>String(s??"").toLowerCase().replace(/[^a-z0-9]/g,"");
 const headers=matrix[0].map(key),lookup=(...names)=>names.map(key).map(k=>headers.indexOf(k)).find(i=>i>=0);
 const ix={id:lookup("Asset ID","Property ID"),address:lookup("Address","Street Address","Property Address"),city:lookup("City"),state:lookup("State"),zip:lookup("ZIP","Zip Code"),type:lookup("Property Type","Type"),beds:lookup("Beds","Bedrooms"),baths:lookup("Baths","Bathrooms"),sqft:lookup("Square Feet","Square Footage","Sq Ft"),occupancy:lookup("Occupancy"),condition:lookup("Condition","Property Condition"),value:lookup("Reference Value","Market Value","Estimated Value","BPO Value"),balance:lookup("Loan Balance","Unpaid Principal Balance","UPB"),repairs:lookup("Repair Estimate","Repairs"),taxes:lookup("Annual Taxes"),hoa:lookup("HOA Monthly"),title:lookup("Title Status"),notes:lookup("Notes")};
 for(const k of ["address","city","state","condition","value"])if(ix[k]===undefined)throw Error("Missing required column: "+({value:"Reference Value"}[k]||k)+". Download the template for accepted headers.");
 const data=matrix.slice(1).filter(row=>row.some(v=>String(v??"").trim()));
 if(data.length>2000)throw Error("Upload up to 2,000 properties per portfolio.");
 const seen=new Set();
 return data.map((r,index)=>{
 const str=k=>String(r[ix[k]]??"").trim().slice(0,500);
 for(const k of ["address","city","state","condition"])if(!str(k))throw Error("Row "+(index+2)+": "+k+" is required.");
 const val=r[ix.value];if(val===""||val==null)throw Error("Row "+(index+2)+": Reference Value is required.");
 let value;try{value=money(val);if(!value)throw Error();}catch{throw Error("Row "+(index+2)+": Reference Value must be a positive whole-dollar amount.");}
 const id=str("id")||"ASSET-"+String(index+1).padStart(4,"");if(seen.has(id))throw Error("Duplicate Asset ID: "+id);seen.add(id);
 const optional=k=>{const v=r[ix[k]];if(v===""||v==null)return 0;try{return money(v);}catch{throw Error("Row "+(index+2)+": invalid "+k+" amount.");}};
 return {id,address:str("address"),city:str("city"),state:str("state"),zip:str("zip"),type:str("type")||"Residential",beds:str("beds"),baths:str("baths"),sqft:str("sqft"),occupancy:str("occupancy")||"Unknown",condition:str("condition"),value,balance:optional("balance"),repairs:optional("repairs"),taxes:optional("taxes"),hoa:optional("hoa"),title:str("title")||"Review required",allocation:Math.round(value*7)/100,notes:str("notes")};
 });
}
function portfolioTotals(rows){return rows.reduce((s,r)=>({count:s.count+1,value:s.value+r.value,price:Math.round((s.value+r.value)*7)/100,repairs:s.repairs+r.repairs,balance:s.balance+r.balance}),{count:0,value:0,price:0,repairs:0,balance:0});}
function portfolioMatrix(rows){return [COLUMNS,...rows.map(r=>[r.id,r.address,r.city,r.state,r.zip,r.type,r.beds,r.baths,r.sqft,r.occupancy,r.condition,r.value,r.balance,r.repairs,r.taxes,r.hoa,r.title,r.allocation,r.notes])];}
function csv(rows){return rows.map(row=>row.map(v=>{let s=String(v??"");if(typeof v==="string"&&/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(",")).join("\r\n");}
globalThis.MreoCore={FEE,DAY,money,createAuction,highest,nextBid,closeAuction,placeBid,seedDemo,outcome,sellerSummary,parseCSV,normalizePortfolio,portfolioTotals,portfolioMatrix,csv,COLUMNS};
})();

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../auction-core.js";
const C=globalThis.MreoCore;
const make=(extra={})=>C.createAuction({id:"test",title:"Test property",sellerId:"seller",minimum:250000,now:1000,...extra});
test("timing survives serialization and supports one or 21 days",()=>{
 const a=make();assert.equal(a.endsAt,1000+86400000);
 assert.equal(JSON.parse(JSON.stringify(a)).endsAt,a.endsAt);
 assert.equal(make({days:21}).endsAt,1000+21*86400000);
 assert.throws(()=>make({days:2}));
});
test("seller minimum includes the fee, and fees are not due at auction close",()=>{
 const a=make();assert.equal(a.reserve,251000);
 C.placeBid(a,{buyerId:"buyer",amount:270000,paid:true,now:2000});
 C.closeAuction(a,a.endsAt);
 assert.equal(a.winnerId,"buyer");
 assert.deepEqual(C.sellerSummary(a),{highest:270000,reserveMet:true,proceeds:269000,additional:19000,feeDue:0});
 a.saleCompleted=true;assert.equal(C.sellerSummary(a).feeDue,1000);
});
test("blind bids accept independent positive amounts while keeping participant checks",()=>{
 const a=make();const bid={buyerId:"a",amount:251000,paid:true,now:2000};
 assert.throws(()=>C.placeBid(a,{...bid,paid:false}),/participation/);
 assert.throws(()=>C.placeBid(a,{...bid,buyerId:"seller"}),/Sellers/);
 for(const amount of [0,"",-1,NaN,Infinity,251000.5,1e16])assert.throws(()=>C.placeBid(a,{...bid,amount}));
 C.placeBid(a,bid);
 for(const amount of [1,250000,251000,251001,251050])C.placeBid(a,{...bid,buyerId:"b",amount});
 assert.equal(a.bids.length,6);assert.equal(C.highest(a).amount,251050);
 assert.equal(C.outcome(a,"a",3000),"submitted");assert.equal(C.outcome(a,"b",3000),"submitted");
 assert.equal(C.outcome(a,"observer",3000),"watching");
});
test("equal bids are accepted and the earliest received offer wins at close",()=>{
 const a=make();
 C.placeBid(a,{buyerId:"first",id:"z-first",amount:260000,paid:true,now:2000});
 C.placeBid(a,{buyerId:"second",id:"a-second",amount:260000,paid:true,now:2000});
 C.placeBid(a,{buyerId:"third",amount:260000,paid:true,now:3000});
 C.closeAuction(a,a.endsAt);assert.equal(a.winnerId,"first");
 assert.equal(C.outcome(a,"second",a.endsAt),"lost");
});
test("buyer snapshots keep other bids private and report results from the full auction",()=>{
 const a=make();
 C.placeBid(a,{buyerId:"winner",amount:300000,paid:true,now:2000});
 C.placeBid(a,{buyerId:"loser",amount:270000,paid:true,now:3000});
 const buyer=C.auctionForViewer(a,"loser","buyer",4000);
 assert.deepEqual(buyer.bids.map(b=>b.amount),[270000]);assert.equal(buyer.bidCount,2);
 assert.equal(buyer.viewerOutcome,"submitted");assert.equal("winnerId" in buyer,false);
 assert.equal(C.auctionForViewer(a,undefined,"buyer",4000).bids.length,0);
 assert.equal(C.auctionForViewer(a,"loser","seller",4000).bids.length,1);
 assert.equal(C.auctionForViewer(a,"seller","buyer",4000).bids.length,0);
 assert.equal(C.auctionForViewer(a,"seller","seller",4000).bids.length,2);
 const closed=C.auctionForViewer(a,"loser","buyer",a.endsAt);
 assert.equal(closed.viewerOutcome,"lost");assert.deepEqual(closed.bids.map(b=>b.amount),[270000]);
 assert.equal(C.auctionForViewer(a,"winner","buyer",a.endsAt).viewerOutcome,"won");
 assert.equal(a.bids.length,2);
});
test("deadline is enforced and green/red outcomes require reserve",()=>{
 const a=make();C.placeBid(a,{buyerId:"a",amount:251000,paid:true,now:2000});
 C.placeBid(a,{buyerId:"b",amount:255000,paid:true,now:3000});
 assert.throws(()=>C.placeBid(a,{buyerId:"c",amount:300000,paid:true,now:a.endsAt}),/closed/);
 assert.equal(C.outcome(a,"b",a.endsAt),"won");
 assert.equal(C.outcome(a,"a",a.endsAt),"lost");
 assert.equal(C.outcome(a,"c",a.endsAt),"not-participating");
 const under=make();C.placeBid(under,{buyerId:"a",amount:240000,paid:true,now:2000});
 C.closeAuction(under,under.endsAt);assert.equal(under.winnerId,null);assert.equal(C.outcome(under,"a",under.endsAt),"reserve-not-met");
 assert.equal(C.sellerSummary(under).feeDue,0);
});
test("demo has exactly three different buyers and never seeds connected auctions",()=>{
 const a=make({demo:true});C.seedDemo(a,31001);assert.equal(a.bids.length,3);
 assert.equal(new Set(a.bids.map(b=>b.buyerId)).size,3);
 assert.equal(new Set(a.bids.map(b=>b.amount)).size,3);
 C.seedDemo(a,35000);assert.equal(a.bids.length,3);
 const live=make();C.seedDemo(live,35000);assert.equal(live.bids.length,0);
 const earlyBid=make({demo:true});C.placeBid(earlyBid,{buyerId:"early",amount:900000,paid:true,now:2000});
 C.seedDemo(earlyBid,35000);assert.equal(earlyBid.bids.length,4);assert.equal(C.highest(earlyBid).buyerId,"early");
});
test("CSV handles quoting, commas, newlines and rejects malformed input",()=>{
 assert.deepEqual(C.parseCSV('a,b\r\n"Oak, Drive","Line 1\nLine ""2"""\r\n'),[["a","b"],["Oak, Drive",'Line 1\nLine "2"']]);
 assert.throws(()=>C.parseCSV('a,"b'),/unclosed/);
 assert.equal(C.csv([["=HYPERLINK(A1)"]]),'"\'=HYPERLINK(A1)"');
});
test("the 150-property portfolio has a 7% price and survives CSV round-trip",async()=>{
 const rows=JSON.parse(await readFile(new URL("../data/reo-sample.json",import.meta.url),"utf8"));
 const total=C.portfolioTotals(rows);
 assert.equal(total.count,150);assert.equal(total.value,68635000);assert.equal(total.price,4804450);
 assert.ok(rows.some(r=>r.condition==="Good"));assert.ok(rows.some(r=>r.condition==="Major rehabilitation"));
 assert.deepEqual(C.normalizePortfolio(C.parseCSV(C.csv(C.portfolioMatrix(rows)))),rows);
});
test("invalid portfolio data is rejected instead of silently dropping properties",()=>{
 const headers=["Asset ID","Address","City","State","Condition","Reference Value"];
 assert.throws(()=>C.normalizePortfolio([["Address"],["x"]]),/Missing required/);
 assert.throws(()=>C.normalizePortfolio([headers,["A","x","Dallas","TX","Good",-1]]),/Reference Value/);
 assert.throws(()=>C.normalizePortfolio([headers,["A","x","Dallas","TX","Good",100],["A","y","Dallas","TX","Fair",100]]),/Duplicate/);
 assert.throws(()=>C.normalizePortfolio([headers,["A","","Dallas","TX","Good",100]]),/address/);
});

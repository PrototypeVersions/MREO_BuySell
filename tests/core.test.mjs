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
test("unpaid participants, sellers, invalid amounts and equal bids cannot bid",()=>{
 const a=make();const bid={buyerId:"a",amount:251000,paid:true,now:2000};
 assert.throws(()=>C.placeBid(a,{...bid,paid:false}),/participation/);
 assert.throws(()=>C.placeBid(a,{...bid,buyerId:"seller"}),/Sellers/);
 for(const amount of [-1,NaN,Infinity,251000.5,1e16])assert.throws(()=>C.placeBid(a,{...bid,amount}));
 C.placeBid(a,bid);assert.throws(()=>C.placeBid(a,{...bid,buyerId:"b"}),/next bid/);
 assert.throws(()=>C.placeBid(a,{...bid,buyerId:"b",amount:251050}),/next bid/);
 C.placeBid(a,{...bid,buyerId:"b",amount:251100});assert.equal(C.highest(a).buyerId,"b");
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

import {chromium} from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const dest=".media-review/turkey";
await fs.mkdir(dest,{recursive:true});
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1920,height:1080}});
try{
 await page.goto("https://www.youtube.com/watch?v=MUdBlpLWFEY",{waitUntil:"domcontentloaded",timeout:60000});
 const reject=page.getByRole("button",{name:"Reject all",exact:true});
 if(await reject.count())await reject.first().click();
 await page.waitForTimeout(7000);
 const text=await page.locator("body").innerText();
 if(/confirm you.re not a bot|sign in to confirm|video unavailable|video is private/i.test(text)){
  throw Error("YouTube requires sign-in or has made this video unavailable in normal browser playback.");
 }
 await page.waitForFunction(()=>{const v=document.querySelector("video");return v&&Number.isFinite(v.duration)&&v.duration>2&&v.videoWidth>0;},{timeout:30000});
 const video=page.locator("video").first();
 await page.evaluate(async()=>{const v=document.querySelector("video");v.muted=true;await v.play();});
 await page.waitForTimeout(3500);
 const source=await video.evaluate(v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration}));
 if(source.width<640)throw Error("Normal playback did not provide a sufficiently clear source for property stills.");
 await video.evaluate(v=>v.pause());
 const frames=[];
 for(let i=0;i<24;i++){
  const timestamp=source.duration*(0.035+i*0.925/23),file="frame-"+String(i+1).padStart(2,"0")+".jpg";
  await video.evaluate((v,time)=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error("Video seek timed out")),20000);
   v.addEventListener("seeked",()=>{clearTimeout(timer);resolve();},{once:true});
   v.currentTime=time;
  }),timestamp);
  await page.waitForTimeout(350);
  await video.screenshot({path:path.join(dest,file),type:"jpeg",quality:97});
  frames.push({file,timestamp:Number(timestamp.toFixed(3)),width:source.width,height:source.height});
 }
 await fs.writeFile(path.join(dest,"frames.json"),JSON.stringify({source:"https://www.youtube.com/watch?v=MUdBlpLWFEY",title:await page.title(),source_width:source.width,source_height:source.height,duration:source.duration,processing:"Real video frames captured through ordinary browser playback.",frames},null,2)+"\n");
 console.log(JSON.stringify({success:true,...source,frames:frames.length}));
}catch(e){
 console.error(e.message);
 process.exitCode=1;
}finally{await browser.close();}

import {SOURCES,readSource} from './clothing.js';
import {browserSources,nikeSizes} from './clothing-browser.js';
import {readMallAlternatives} from './clothing-malls.js';
export async function collectClothingSources(ids,checkedAt,{browser=false,read=readSource,render=browserSources,sizes=nikeSizes,malls=readMallAlternatives}={}){
  const selected=SOURCES.filter(s=>ids.includes(s.id)),results=[];
  for(let i=0;i<selected.length;i+=2)results.push(...await Promise.all(selected.slice(i,i+2).map(s=>read(s,checkedAt))));
  if(browser){
    const chosen=selected.filter(s=>s.browser),rendered=chosen.length?await render(chosen,checkedAt):[];
    for(const r of rendered){const index=results.findIndex(s=>s.id===r.id),old=results[index];if(r.items.length || r.campaigns.length)results[index]={...r,items:r.items.length?r.items:old.items,candidates:old.candidates || []};else if(!old.items.length)results[index]={...r,candidates:old.candidates || []};}
    const nike=results.find(r=>r.id==='nike');
    if(nike?.items.length){const {found,stopped}=await sizes([...nike.items].sort((a,b)=>a.price/a.originalPrice-b.price/b.originalPrice));nike.items=nike.items.map(i=>found.has(i.id)?{...i,...found.get(i.id),sizeSystem:i.category==='Footwear'?'US men':'Labelled clothing'}:i);nike.sizesChecked=found.size;nike.message='Published PHP markdowns read; sizes in stock checked on '+found.size+' of '+nike.items.length+' product pages'+(stopped?' (stopped: '+stopped+')':'')+'.';}
  }
  const mallIds=ids.filter(id=>['sm-search','sc-events'].includes(id));
  if(mallIds.length){const found=await malls(checkedAt,{sourceIds:mallIds,candidates:results.flatMap(r=>r.candidates || [])});for(const s of found.sources)results.push({...s,items:[],campaigns:[],promos:found.promos.filter(r=>(s.id==='sc-events')===(r.retailer==='Sports Central'))});}
  return results;
}

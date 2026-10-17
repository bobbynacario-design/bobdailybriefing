// Ordinary public browser rendering in the scheduled job. No user sessions,
// credentials, stealth plugins, proxies, CAPTCHA solving or security bypass.
import {parseRendered} from './clothing-rendered.js';
export async function browserSources(sources,checkedAt){
  let browser;const out=[];
  try{
    const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});
    const context=await browser.newContext({locale:'en-PH',viewport:{width:1280,height:900}});
    for(const source of sources){
      const page=await context.newPage();page.setDefaultTimeout(14000);
      try{
        const response=await page.goto(source.url,{waitUntil:'domcontentloaded',timeout:30000});
        if(response && response.status()>=400)throw Error('Browser HTTP '+response.status());
        const snippet=(await page.locator('body').innerText()).slice(0,3000);
        if(/access denied|verify (?:that )?you are human|unusual traffic|complete the captcha/i.test(snippet))throw Error('Public page requires a human check; skipped.');
        if(source.id==='adidas'){
          const reject=page.getByRole('button',{name:'REJECT ALL',exact:true});if(await reject.isVisible())await reject.click();
        }
        if(source.id==='crocs'){
          const sale=page.getByRole('link',{name:'SALE',exact:true}).first();
          if(await sale.count()){
            const href=await sale.getAttribute('href'),target=new URL(href,source.url);
            if(target.origin==='https://crocs.com.ph' && target.pathname.startsWith('/collections/') && target.href!==page.url())await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:20000});
          }
        }
        const selector=source.id==='uniqlo'?'a.product-tile__link[href*="/ph/en/products/"]':source.id==='adidas'?'[data-testid="plp-product-card"]':source.id.startsWith('zalora')?'a[data-test-id="productLink"]':'h1';
        await page.locator(selector).first().waitFor({state:'attached',timeout:18000});
        // Snapshot only rendered DOM; the parser never reads browser cookies,
        // local storage, private API responses or application internals.
        const html=source.id==='crocs'?'<h1>'+(await page.locator('h1').first().innerText()).replace(/[<>]/g,'')+'</h1>':await page.locator(selector).evaluateAll(nodes=>nodes.slice(0,60).map(n=>n.outerHTML).join('\n'));
        const parsed=parseRendered(source,html,checkedAt,page.url());
        out.push({...source,checkedAt,...parsed,status:parsed.items.length?'ok':parsed.campaigns.length?'announcements':'unpriced',count:parsed.items.length,method:'browser',message:parsed.items.length?'PHP item markdowns read from the rendered public catalogue; size stock unverified.':'Only separately labelled leads or conditional offers were readable; no unconditional item discount inferred.'});
      }catch(e){out.push({...source,checkedAt,items:[],campaigns:[],status:'unavailable',count:0,method:'browser',message:String(e.message).slice(0,180)});}
      finally{await page.close();}
    }
  }catch(e){for(const source of sources)if(!out.some(r=>r.id===source.id))out.push({...source,checkedAt,items:[],campaigns:[],status:'unavailable',count:0,method:'browser',message:'Browser reader unavailable: '+String(e.message).slice(0,100)});}
  finally{if(browser)await browser.close();}
  return out;
}

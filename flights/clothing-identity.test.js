import {test} from 'node:test';import assert from 'node:assert/strict';
import {catalogueIdentity} from './clothing-identity.js';import {parseShopify,SOURCES} from './clothing.js';
test('public manufacturer fields, style options and printed codes are distinct from retailer SKUs',()=>{
 const p={title:'adidas Men Cotton Tee | JJ4008',body_html:'<p>Product Code: JJ4008<br>Color: Black<br>Gender: Men</p>',options:[{name:'Size'},{name:'Style'}]},v={option1:'M',option2:'JJ4008',sku:'SCP-10864401'};
 assert.deepEqual(catalogueIdentity('Adidas',p,v),{styleCode:'JJ4008',publishedColor:'Black'});
 assert.equal(catalogueIdentity('Adidas',{title:'Cotton Tee',options:[]},{sku:'SCP-10864401'}).styleCode,undefined);
 assert.equal(catalogueIdentity('Adidas',{title:'Cotton Tee',options:[]},{sku:'KI0074_5UK/5US'}).styleCode,'KI0074');
 assert.equal(catalogueIdentity('Adidas',p,{...v,option2:'JJ4009'}).styleCode,undefined);
 assert.equal(catalogueIdentity('Nike',{title:'Nike Tee',body_html:'<p>Style: DV1234-001</p>'},{sku:'store1234'}).styleCode,'DV1234-001');
 const source=SOURCES.find(s=>s.id==='sc-adidas'),rows=parseShopify(source,[{...p,id:1,vendor:'adidas',product_type:'Men Tops',handle:'tee',tags:[],variants:[{...v,id:1,available:true,price:'1080',compare_at_price:'1800'}]}],'2026-11-28T05:00:00Z');assert.equal(rows[0].styleCode,'JJ4008');assert.equal(rows[0].color,'Black');
});

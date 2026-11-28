(function(root){
  'use strict';
  // Inject the Firebase SDK so the exact transaction can also run in fixtures.
  function create(a){
    function check(uid){if(!uid || uid!==a.uid() || !a.owner())throw Error('Account changed. Sign in as the owner and reload Packing.');}
    function ref(prefix,uid){return a.doc(a.db,a.coll,prefix+uid);}
    async function readOwn(prefix,kind){
      var uid=a.uid();check(uid);var data;
      try{var snap=await a.getDoc(ref(prefix,uid));data=snap.exists()?snap.data():{};}
      catch(e){if(e.code!=='permission-denied')throw e;check(uid);var rows=await a.getDocs(a.query(a.collection(a.db,a.coll),a.where('uid','==',uid),a.where('kind','==',kind),a.limit(1)));data=rows.empty?{}:rows.docs[0].data();}
      check(uid);return data;
    }
    async function load(){var data=await readOwn('trip-packing-','trip-packing');return root.TripPacking.plans(data.plans);}
    async function loadProfile(){return root.ShoppingCore.cleanPrefs(await readOwn('shopping-prefs-','shopping-prefs'));}
    async function save(id,cmd){
      var uid=a.uid();check(uid);
      var packing=ref('trip-packing-',uid),booked=ref('trips-booked-',uid),shopping=ref('shopping-prefs-',uid),missing=null;
      async function run(){return a.runTransaction(a.db,async function(tx){
        check(uid);
        async function read(r,kind){try{return await tx.get(r);}catch(e){if(e.code==='permission-denied' && kind)missing={ref:r,kind:kind};throw e;}}
        var ps=await read(packing,'trip-packing'),bs=await read(booked),needsProfile=cmd.op==='need' || cmd.op==='put' && cmd.item && (cmd.item.purchaseId || cmd.item.needId),ss=needsProfile?await read(shopping,'shopping-prefs'):null;
        check(uid);var trip=bs.exists() && (bs.data().items || {})[id];
        var result=root.TripPacking.apply(ps.exists()?ps.data().plans:{},id,trip,cmd,ss?(ss.exists()?root.ShoppingCore.cleanPrefs(ss.data()):root.ShoppingCore.cleanPrefs()):null);
        var now=new Date().toISOString(),data={uid:uid,kind:'trip-packing',plans:result.plans,updatedAt:now};
        if(new TextEncoder().encode(JSON.stringify(data)).length>850000)throw Error('Your packing history is full. Remove an unused checklist before saving.');
        check(uid);tx.set(packing,data);
        if(result.profile){if(new TextEncoder().encode(JSON.stringify(result.profile)).length>850000)throw Error('Your Clothing details are full. Remove a saved deal before adding a need.');tx.set(shopping,Object.assign({},result.profile,{uid:uid,kind:'shopping-prefs',updatedAt:now}));}
        return result;
      });}
      // Missing private documents can be unreadable under the shared rules.
      // Prime metadata only; merge never replaces another device’s records.
      for(var attempt=0;attempt<3;attempt++){
        missing=null;
        try{var result=await run();check(uid);return result;}
        catch(e){if(e.code!=='permission-denied' || !missing || attempt===2)throw e;check(uid);await a.setDoc(missing.ref,{uid:uid,kind:missing.kind},{merge:true});}
      }
    }
    return {load:load,loadProfile:loadProfile,save:save};
  }
  root.TripPackingStorage={create:create};
})(typeof globalThis!=='undefined'?globalThis:this);
